"""Address -> PNU -> cadastral boundary and official GIS designation adapters.

Keys stay in server environment variables. Request destinations are constants;
upstream response bodies, URLs and credentials never appear in public errors.
HTTP uses Python's standard library. Polygon intersections reuse the application's
existing bundled JavaScript polygon engine through its installed Node runtime.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import error, parse, request

_ENDPOINTS = {
    "juso": "https://business.juso.go.kr/addrlink/addrLinkApi.do",
    "vworld_search": "https://api.vworld.kr/req/search",
    "vworld_data": "https://api.vworld.kr/req/data",
}
_PNU = re.compile(r"^[0-9]{19}$")
_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_REQUEST_TIMEOUT = 5.0
_SEARCH_BUDGET = 18.0
_MAX_CANDIDATES = 10
_MAX_COORDINATES = 2000
_MAX_REGULATION_COORDINATES = 50000
_MAX_REGULATION_FEATURES = 1000
_REGULATORY_NOTE = "주소·경계 조회만으로 용도지역·지구단위계획·건폐율·용적률·주차 규제를 확인하지 않습니다. 필지별 규제 조회와 고시 원문 확인이 필요합니다."
_REPRESENTATIVE_NOTE = "도로명주소는 대표 지번에 대응할 수 있습니다. 관련 지번과 실제 사업 대상 경계를 확인해 주세요."
# IDs/titles were checked against the official WFS GetCapabilities response on
# 2026-10-21. Schema evidence is kept without credentials in law-evidence/.
_REGULATION_LAYERS = (
    ("LT_C_UQ111", "도시지역", "zone", "uq111"),
    ("LT_C_UQ112", "관리지역", "zone", "uq112"),
    ("LT_C_UQ113", "농림지역", "zone", "uq113"),
    ("LT_C_UQ114", "자연환경보전지역", "zone", "uq114"),
    ("LT_C_UPISUQ161", "지구단위계획", "district", "upisuq161"),
)
# Official WFS capabilities/schemas and live Data responses checked 2026-10-21.
# A planning polygon is not promoted to an existing physical road. The road
# width fields' meaning/unit have not been verified, so widthM remains unknown.
_CONTEXT_LAYERS = (
    ("LP_PA_CBND_BUBUN", "연속지적도", "cadastral"),
    ("LT_L_SPRD", "도로명주소도로", "road-centerline"),
    ("LT_L_N3A0020000", "도로중심선", "road-centerline"),
    ("LT_C_UPISUQ151", "도시계획도로", "planned-road"),
)
_CONTEXT_PAGE_SIZE = 300
_MAX_CONTEXT_FEATURES = 600
_MAX_CONTEXT_COORDINATES = 80000


class ParcelServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ParcelServiceError("UPSTREAM_REDIRECT", "공공자료 제공 서버가 지원하지 않는 경로로 응답했습니다.", 502)


def _key(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if len(value) > 1024 or re.search(r"[\x00-\x20\x7f]", value):
        raise ParcelServiceError("CONFIG_INVALID", "공공데이터 API 서버 설정 형식을 확인해 주세요.", 503)
    return value


def _domain() -> str:
    value = os.environ.get("VWORLD_DOMAIN", "http://127.0.0.1:8090").strip()
    try:
        parsed = parse.urlsplit(value)
    except ValueError:
        raise ParcelServiceError("CONFIG_INVALID", "VWORLD_DOMAIN에 승인된 서비스 주소를 설정해 주세요.", 503) from None
    if (len(value) > 300 or re.search(r"[\x00-\x20\x7f]", value) or parsed.scheme not in ("http", "https")
            or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ParcelServiceError("CONFIG_INVALID", "VWORLD_DOMAIN에 승인된 서비스 주소를 설정해 주세요.", 503)
    return value


def status() -> dict:
    # Presence only: no key values or domain values are returned.
    juso = bool(os.environ.get("JUSO_API_KEY", "").strip())
    vworld = bool(os.environ.get("VWORLD_API_KEY", "").strip())
    return {
        "configurationOnly": True,
        "addressSearchReady": juso or vworld,
        "boundaryReady": vworld,
        "providers": {"juso": {"configured": juso}, "vworld": {"configured": vworld}},
        "regulations": {"status": "unverified", "note": _REGULATORY_NOTE},
        "notes": [_REPRESENTATIVE_NOTE],
    }


def _reject_constant(_value):
    raise ValueError("Non-finite JSON number")


def _get_json(endpoint: str, params: dict, deadline: float | None = None) -> dict:
    if endpoint not in _ENDPOINTS:
        raise ParcelServiceError("INVALID_PROVIDER", "지원하지 않는 공공자료 제공 경로입니다.", 400)
    remaining = _REQUEST_TIMEOUT if deadline is None else min(_REQUEST_TIMEOUT, deadline - time.monotonic())
    if remaining <= 0:
        raise ParcelServiceError("UPSTREAM_TIMEOUT", "공공자료 조회 시간이 초과되었습니다. 주소를 구체적으로 입력해 다시 조회해 주세요.", 504)
    url = _ENDPOINTS[endpoint] + "?" + parse.urlencode(params)
    req = request.Request(url, headers={"Accept": "application/json", "User-Agent": "FORMEQUA-Parcel/1.0"})
    opener = request.build_opener(request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect())
    try:
        with opener.open(req, timeout=remaining) as response:
            length = response.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > _MAX_RESPONSE_BYTES:
                raise ParcelServiceError("UPSTREAM_TOO_LARGE", "공공자료 응답이 지원 크기를 초과했습니다.", 502)
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise ParcelServiceError("UPSTREAM_TOO_LARGE", "공공자료 응답이 지원 크기를 초과했습니다.", 502)
        decoded = json.loads(raw.decode("utf-8-sig"), parse_constant=_reject_constant)
        if not isinstance(decoded, dict):
            raise ValueError("Expected JSON object")
        return decoded
    except ParcelServiceError:
        raise
    except (TimeoutError, socket.timeout):
        raise ParcelServiceError("UPSTREAM_TIMEOUT", "공공자료 제공 서버의 응답 시간이 초과되었습니다.", 504) from None
    except error.HTTPError:
        raise ParcelServiceError("UPSTREAM_HTTP", "공공자료 제공 서버에서 요청을 처리하지 못했습니다. API 승인 상태를 확인해 주세요.", 502) from None
    except error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ParcelServiceError("UPSTREAM_TIMEOUT", "공공자료 제공 서버의 응답 시간이 초과되었습니다.", 504) from None
        raise ParcelServiceError("UPSTREAM_UNAVAILABLE", "공공자료 제공 서버에 연결하지 못했습니다.", 502) from None
    except (ValueError, UnicodeError, TypeError):
        raise ParcelServiceError("UPSTREAM_FORMAT", "공공자료 제공 서버의 응답 형식을 확인할 수 없습니다.", 502) from None


def _text(value, limit=500) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\x00-\x1f\x7f]", "", value).strip()[:limit]


def _pnu(value) -> str | None:
    return value if isinstance(value, str) and _PNU.fullmatch(value) else None


def _query(value) -> str:
    if not isinstance(value, str) or re.search(r"[\x00-\x1f\x7f]", value):
        raise ParcelServiceError("INVALID_ADDRESS", "주소는 2~200자의 텍스트로 입력해 주세요.", 400)
    clean = value.strip()
    if not 2 <= len(clean) <= 200:
        raise ParcelServiceError("INVALID_ADDRESS", "주소는 2~200자로 입력해 주세요.", 400)
    return clean


def _juso_pnu(item: dict) -> str | None:
    adm = item.get("admCd")
    mountain = str(item.get("mtYn", ""))
    main = str(item.get("lnbrMnnm", ""))
    sub = str(item.get("lnbrSlno", ""))
    if (not isinstance(adm, str) or not re.fullmatch(r"[0-9]{10}", adm) or mountain not in ("0", "1")
            or not re.fullmatch(r"[0-9]{1,4}", main) or not re.fullmatch(r"[0-9]{1,4}", sub)
            or int(main) == 0):
        return None
    return adm + ("1" if mountain == "0" else "2") + main.zfill(4) + sub.zfill(4)


def _juso_search(q: str, key: str, deadline: float) -> dict:
    payload = _get_json("juso", {"confmKey": key, "keyword": q, "currentPage": 1,
        "countPerPage": _MAX_CANDIDATES, "resultType": "json", "addInfoYn": "Y"}, deadline)
    results = payload.get("results")
    if not isinstance(results, dict) or not isinstance(results.get("common"), dict):
        raise ParcelServiceError("UPSTREAM_FORMAT", "주소정보 응답 형식을 확인할 수 없습니다.", 502)
    common = results["common"]
    if str(common.get("errorCode")) != "0":
        raise ParcelServiceError("ADDRESS_PROVIDER_REJECTED", "주소정보 검색을 완료하지 못했습니다. API 승인 상태와 검색어를 확인해 주세요.", 502)
    items = results.get("juso") or []
    if not isinstance(items, list):
        raise ParcelServiceError("UPSTREAM_FORMAT", "주소 후보 응답 형식을 확인할 수 없습니다.", 502)
    candidates = []
    seen = set()
    malformed = False
    for item in items[:_MAX_CANDIDATES]:
        if not isinstance(item, dict):
            malformed = True
            continue
        pnu = _juso_pnu(item)
        if not pnu:
            malformed = True
            continue
        if pnu in seen:
            continue
        seen.add(pnu)
        road, jibun = _text(item.get("roadAddr")), _text(item.get("jibunAddr"))
        candidate = {"pnu": pnu, "address": jibun or road, "roadAddress": road,
            "jibunAddress": jibun, "source": "juso", "pnuMethod": "legal-dong-and-lot-number"}
        related = _text(item.get("relJibun"), 1000)
        if related:
            candidate["relatedJibun"] = related
        candidates.append(candidate)
    if items and not candidates and malformed:
        raise ParcelServiceError("ADDRESS_PNU_UNRESOLVED", "주소 후보의 법정동코드·지번을 확인하지 못해 PNU를 확정하지 않았습니다.", 502)
    try:
        total = max(len(items), int(common.get("totalCount", len(items))))
    except (ValueError, TypeError):
        total = len(items)
    notes = [_REPRESENTATIVE_NOTE, _REGULATORY_NOTE]
    if malformed:
        notes.append("PNU를 확정할 수 없는 주소 후보는 제외했습니다.")
    return {"provider": "juso", "query": q, "candidates": candidates, "totalCount": total,
        "truncated": total > _MAX_CANDIDATES, "notes": notes}


def _vworld(endpoint: str, params: dict, deadline=None) -> dict:
    key = _key("VWORLD_API_KEY")
    if not key:
        raise ParcelServiceError("PROVIDER_NOT_CONFIGURED", "필지 경계 조회를 위해 서버에 VWORLD_API_KEY를 설정해 주세요.", 503)
    response = _get_json(endpoint, {"key": key, "domain": _domain(), "format": "json", "version": "2.0", **params}, deadline).get("response")
    if not isinstance(response, dict):
        raise ParcelServiceError("UPSTREAM_FORMAT", "브이월드 응답 형식을 확인할 수 없습니다.", 502)
    provider_status = response.get("status")
    if provider_status not in ("OK", "NOT_FOUND"):
        raise ParcelServiceError("PARCEL_PROVIDER_REJECTED", "브이월드 조회를 완료하지 못했습니다. API 승인·도메인·사용량을 확인해 주세요.", 502)
    return response


def _data_features(*, pnu=None, point=None, deadline=None) -> list:
    params = {"service": "data", "request": "GetFeature", "data": "LP_PA_CBND_BUBUN",
        "crs": "EPSG:4326", "geometry": "true", "attribute": "true", "size": 10, "page": 1}
    if pnu is not None:
        params["attrFilter"] = f"pnu:=:{pnu}"
    elif point is not None:
        params["geomFilter"] = f"POINT({point[0]:.9f} {point[1]:.9f})"
    else:
        raise ParcelServiceError("INVALID_FILTER", "PNU 또는 주소 좌표가 필요합니다.", 400)
    response = _vworld("vworld_data", params, deadline)
    if response["status"] == "NOT_FOUND":
        return []
    result = response.get("result")
    collection = result.get("featureCollection") if isinstance(result, dict) else None
    if not isinstance(collection, dict) or not isinstance(collection.get("features"), list):
        raise ParcelServiceError("UPSTREAM_FORMAT", "필지 경계 응답 형식을 확인할 수 없습니다.", 502)
    features = collection["features"]
    if len(features) > 10:
        raise ParcelServiceError("UPSTREAM_TOO_LARGE", "필지 경계 응답의 필지 수가 지원 범위를 초과했습니다.", 502)
    # A cadastral identifier may be split across several Features. Never treat
    # a first page as the complete boundary if pagination proves it is partial.
    def metadata_count(container, name):
        if container is None:
            return None
        if not isinstance(container, dict):
            raise ParcelServiceError("UPSTREAM_FORMAT", "필지 경계의 페이지 정보를 확인할 수 없습니다.", 502)
        value = container.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value)):
            raise ParcelServiceError("UPSTREAM_FORMAT", "필지 경계의 페이지 정보를 확인할 수 없습니다.", 502)
        return int(value)
    total = metadata_count(response.get("record"), "total")
    current_count = metadata_count(response.get("record"), "current")
    pages = metadata_count(response.get("page"), "total")
    current_page = metadata_count(response.get("page"), "current")
    if ((total is not None and total != len(features))
            or (current_count is not None and current_count != len(features))
            or (pages is not None and pages > 1)
            or (current_page is not None and current_page > 1)
            or (features and (pages == 0 or current_page == 0))
            or (len(features) == 10 and total is None and pages is None)):
        raise ParcelServiceError("PARCEL_BOUNDARY_INCOMPLETE", "필지 경계 응답이 일부이거나 전체 건수와 일치하지 않아 적용하지 않았습니다. 전체 경계를 확인한 뒤 다시 조회해 주세요.", 502)
    return features


def _feature_pnu(feature) -> str | None:
    if not isinstance(feature, dict) or not isinstance(feature.get("properties"), dict):
        return None
    props = feature["properties"]
    return _pnu(props.get("pnu")) or _pnu(props.get("PNU"))


def _point(value) -> tuple | None:
    if not isinstance(value, dict):
        return None
    try:
        x, y = float(value.get("x")), float(value.get("y"))
        if not (math.isfinite(x) and math.isfinite(y) and 124 <= x <= 132 and 33 <= y <= 39):
            return None
        return x, y
    except (ValueError, TypeError):
        return None


def _vworld_search(q: str, deadline: float) -> dict:
    candidates, seen = [], set()
    total = 0
    unresolved = False
    for category in ("parcel", "road"):
        response = _vworld("vworld_search", {"service": "search", "request": "search", "query": q,
            "type": "address", "category": category, "crs": "EPSG:4326", "size": 10, "page": 1}, deadline)
        if response["status"] == "NOT_FOUND":
            continue
        result = response.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("items"), list):
            raise ParcelServiceError("UPSTREAM_FORMAT", "주소 후보 응답 형식을 확인할 수 없습니다.", 502)
        items = result["items"]
        try:
            record = response.get("record") if isinstance(response.get("record"), dict) else {}
            total = max(total, int(record.get("total", len(items))))
        except (ValueError, TypeError):
            total = max(total, len(items))
        for item in items[:_MAX_CANDIDATES]:
            if not isinstance(item, dict):
                unresolved = True
                continue
            address = item.get("address") if isinstance(item.get("address"), dict) else {}
            road, jibun = _text(address.get("road")), _text(address.get("parcel"))
            pnu = _pnu(item.get("id"))
            point = _point(item.get("point"))
            resolved = [pnu] if pnu else []
            method = "address-id"
            if not resolved and point:
                method = "cadastral-point-lookup"
                resolved = sorted({value for feature in _data_features(point=point, deadline=deadline)
                    if (value := _feature_pnu(feature))})
            if not resolved:
                unresolved = True
            for value in resolved:
                if value in seen:
                    continue
                seen.add(value)
                candidate = {"pnu": value, "address": jibun or road, "roadAddress": road,
                    "jibunAddress": jibun, "source": "vworld", "pnuMethod": method}
                if point:
                    candidate["point"] = {"x": point[0], "y": point[1]}
                if len(resolved) > 1:
                    candidate["note"] = "주소 좌표가 복수 필지와 만납니다. 대상 지번을 선택해 주세요."
                candidates.append(candidate)
                if len(candidates) == _MAX_CANDIDATES:
                    break
            if len(candidates) == _MAX_CANDIDATES:
                break
        if candidates:
            # A successful address category is not merged with a second,
            # differently interpreted address search.
            break
    notes = [_REPRESENTATIVE_NOTE, _REGULATORY_NOTE]
    if unresolved:
        notes.append("PNU를 확정할 수 없는 후보는 제외했습니다. 더 구체적인 주소로 다시 검색할 수 있습니다.")
    return {"provider": "vworld", "query": q, "candidates": candidates, "totalCount": max(total, len(candidates)),
        "truncated": total > _MAX_CANDIDATES, "notes": notes}


def search_addresses(q: str) -> dict:
    query = _query(q)
    deadline = time.monotonic() + _SEARCH_BUDGET
    juso = _key("JUSO_API_KEY")
    if juso:
        return _juso_search(query, juso, deadline)
    if _key("VWORLD_API_KEY"):
        return _vworld_search(query, deadline)
    raise ParcelServiceError("PROVIDER_NOT_CONFIGURED", "주소 검색을 위해 서버에 JUSO_API_KEY 또는 VWORLD_API_KEY를 설정해 주세요.", 503)


def _geometry(value: dict, counter: list, coordinate_limit: int = _MAX_COORDINATES) -> dict:
    if not isinstance(value, dict) or value.get("type") not in ("Polygon", "MultiPolygon"):
        raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계가 Polygon/MultiPolygon 형식이 아닙니다.", 502)
    coordinates = value.get("coordinates")
    polygons = [coordinates] if value["type"] == "Polygon" else coordinates
    if not isinstance(polygons, list) or not polygons:
        raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계 좌표가 없습니다.", 502)
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계 고리 형식이 올바르지 않습니다.", 502)
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계 고리가 닫혀 있지 않습니다.", 502)
            for coordinate in ring:
                counter[0] += 1
                if counter[0] > coordinate_limit:
                    raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계의 좌표 수가 지원 범위를 초과했습니다.", 502)
                if (not isinstance(coordinate, list) or len(coordinate) != 2
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in coordinate)
                        or not (124 <= coordinate[0] <= 132 and 33 <= coordinate[1] <= 39)):
                    raise ParcelServiceError("INVALID_GEOMETRY", "필지 경계의 EPSG:4326 좌표 범위를 확인할 수 없습니다.", 502)
    return {"type": value["type"], "coordinates": copy.deepcopy(coordinates)}


def fetch_parcel(pnu: str) -> dict:
    confirmed = _pnu(pnu)
    if not confirmed:
        raise ParcelServiceError("INVALID_PNU", "PNU는 19자리 숫자로 입력해 주세요.", 400)
    features = _data_features(pnu=confirmed, deadline=time.monotonic() + _SEARCH_BUDGET)
    if not features:
        raise ParcelServiceError("PARCEL_NOT_FOUND", "해당 PNU의 필지 경계를 찾지 못했습니다.", 404)
    canonical = []
    counter = [0]
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature" or _feature_pnu(feature) != confirmed:
            raise ParcelServiceError("PNU_MISMATCH", "조회한 PNU와 반환된 필지 경계가 일치하지 않습니다.", 502)
        props = feature["properties"]
        clean_props = {"pnu": confirmed, "source": "vworld"}
        address = _text(props.get("addr")) or _text(props.get("address")) or _text(props.get("full_nm"))
        if address:
            clean_props["address"] = address
        canonical.append({"type": "Feature", "geometry": _geometry(feature.get("geometry"), counter), "properties": clean_props})
    if len(canonical) > 1:
        # A provider may split one cadastral identifier into several features.
        # Preserve all parts as one PNU/Feature; the shared JS geometry engine
        # performs the actual topological union before applying the study.
        polygons = []
        for item in canonical:
            geometry = item["geometry"]
            polygons.extend([geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"])
        canonical = [{"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": polygons},
            "properties": canonical[0]["properties"]}]
    return {"version": 1, "features": canonical, "source": "vworld",
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}


_INTERSECTION_JS = r"""
'use strict';
const clip=require(process.argv[1]);
let raw='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>24000000)process.exit(2);});
process.stdin.on('end',()=>{
  try {
    const data=JSON.parse(raw),first=data.parcel.features[0].geometry;
    const origin=first.type==='Polygon'?first.coordinates[0][0]:first.coordinates[0][0][0];
    const R=6371008.8,rad=Math.PI/180,sx=R*rad*Math.cos(origin[1]*rad),sy=R*rad;
    const project=g=>(g.type==='Polygon'?[g.coordinates]:g.coordinates)
      .map(p=>p.map(r=>r.map(([lon,lat])=>[(lon-origin[0])*sx,(lat-origin[1])*sy])));
    const ringArea=r=>{const o=r[0];let area=0;for(let i=0;i<r.length-1;i++)area+=(r[i][0]-o[0])*(r[i+1][1]-o[1])-(r[i+1][0]-o[0])*(r[i][1]-o[1]);return Math.abs(area)/2;};
    const area=m=>m.reduce((sum,p)=>sum+ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0),0);
    const parcel=clip.union(...data.parcel.features.map(f=>project(f.geometry)));
    const areas=[],zoneGeometries=[];
    for(const group of data.overlays){
      const united=clip.union(...group.geometries.map(project));
      const intersection=clip.intersection(parcel,united);
      areas.push(area(intersection));
      if(group.kind==='zone'&&intersection.length)zoneGeometries.push(intersection);
    }
    const covered=zoneGeometries.length?area(clip.union(...zoneGeometries)):0;
    process.stdout.write(JSON.stringify({parcelAreaSqm:area(parcel),areas,zoningCoverageAreaSqm:covered}));
  } catch(_){process.exit(2);}
});
"""


def _intersection_areas(parcel_data: dict, groups: list) -> dict:
    """Use the same bundled polygon engine as the WebGL application.

    The script is fixed source, the vendor module path is server-owned, and all
    user/provider coordinates travel as JSON on stdin rather than shell code.
    No environment value, URL or provider error is copied into the result.
    """
    node = shutil.which("node")
    vendor = Path(__file__).resolve().parent / "vendor" / "polygon-clipping-0.15.7.umd.min.js"
    if not node or not vendor.is_file():
        raise ParcelServiceError("INTERSECTION_UNAVAILABLE", "필지별 교차면적 계산 모듈이 준비되지 않았습니다.", 503)
    raw = json.dumps({"parcel": parcel_data, "overlays": groups}, ensure_ascii=False, allow_nan=False)
    try:
        completed = subprocess.run([node, "-e", _INTERSECTION_JS, str(vendor)], input=raw,
            capture_output=True, text=True, encoding="utf-8", timeout=8, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if completed.returncode != 0 or len(completed.stdout) > 100000:
            raise ValueError("invalid intersection response")
        result = json.loads(completed.stdout, parse_constant=_reject_constant)
        areas = result.get("areas")
        parcel_area = result.get("parcelAreaSqm")
        covered = result.get("zoningCoverageAreaSqm")
        if (not isinstance(areas, list) or len(areas) != len(groups)
                or not isinstance(parcel_area, (int, float)) or not math.isfinite(parcel_area) or parcel_area <= 0
                or not isinstance(covered, (int, float)) or not math.isfinite(covered) or covered < 0
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    or value < 0 or value > parcel_area + 0.01 for value in areas)):
            raise ValueError("invalid intersection areas")
        return result
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
        raise ParcelServiceError("INTERSECTION_UNAVAILABLE", "필지별 교차면적을 계산하지 못했습니다. 공간자료를 다시 확인해 주세요.", 503) from None


def _regulation_features(layer: str, bbox: tuple, deadline: float) -> tuple[list, bool]:
    if layer not in {item[0] for item in _REGULATION_LAYERS}:
        raise ParcelServiceError("INVALID_LAYER", "지원하지 않는 규제 자료 레이어입니다.", 400)
    response = _vworld("vworld_data", {"service": "data", "request": "GetFeature", "data": layer,
        "geomFilter": f"BOX({bbox[0]:.9f},{bbox[1]:.9f},{bbox[2]:.9f},{bbox[3]:.9f})",
        "crs": "EPSG:4326", "geometry": "true", "attribute": "true",
        "size": _MAX_REGULATION_FEATURES, "page": 1}, deadline)
    if response["status"] == "NOT_FOUND":
        return [], True
    result = response.get("result")
    collection = result.get("featureCollection") if isinstance(result, dict) else None
    if not isinstance(collection, dict) or not isinstance(collection.get("features"), list):
        raise ParcelServiceError("UPSTREAM_FORMAT", "규제 공간자료 응답 형식을 확인할 수 없습니다.", 502)
    features = collection["features"]
    if len(features) > _MAX_REGULATION_FEATURES:
        raise ParcelServiceError("UPSTREAM_TOO_LARGE", "규제 공간자료의 경계 수가 지원 범위를 초과했습니다.", 502)
    record = response.get("record") if isinstance(response.get("record"), dict) else {}
    page = response.get("page") if isinstance(response.get("page"), dict) else {}
    try:
        complete = int(record.get("total", len(features))) <= len(features) and int(page.get("total", 1)) <= 1
    except (ValueError, TypeError):
        complete = False
    return features, complete


def _parcel_bbox(parcel: dict) -> tuple:
    points = []
    for feature in parcel["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            for ring in polygon:
                points.extend(ring)
    return (min(point[0] for point in points), min(point[1] for point in points),
        max(point[0] for point in points), max(point[1] for point in points))


def _regulation_groups(features: list, layer: str, kind: str) -> tuple[list, bool]:
    grouped = {}
    missing_names = False
    counter = [0]
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
            raise ParcelServiceError("UPSTREAM_FORMAT", "규제 경계의 속성 형식을 확인할 수 없습니다.", 502)
        props = feature["properties"]
        # Exact official fields only. Unknown fields, including numeric-looking
        # FAR/BCR properties, are never promoted to confirmed legal limits.
        name = _text(props.get("uname") if kind == "zone" else props.get("dgm_nm"), 300)
        code = _text(props.get("ucode") if kind == "zone" else props.get("present_sn"), 120)
        if not name:
            missing_names = True
            continue
        identity = (name, code)
        if identity not in grouped:
            item = {"name": name, "source": f"VWorld · {layer}"}
            if code:
                item["code"] = code
            if kind == "district":
                notice = _text(props.get("ntfc_sn"), 200)
                if notice:
                    item["noticeId"] = notice
            grouped[identity] = {"kind": kind, "item": item, "geometries": []}
        grouped[identity]["geometries"].append(_geometry(feature.get("geometry"), counter, _MAX_REGULATION_COORDINATES))
    return list(grouped.values()), missing_names


def fetch_parcel_regulations(pnu: str) -> dict:
    """Return parcel-intersecting official GIS designations, not legal approval.

    Five fixed VWorld layers are queried against the cadastral bounding box.
    Exact polygon intersection then removes neighboring and boundary-touching
    candidates and measures each named designation's actual coverage.
    """
    if not _pnu(pnu):
        raise ParcelServiceError("INVALID_PNU", "PNU는 19자리 숫자로 입력해 주세요.", 400)
    if not _key("VWORLD_API_KEY"):
        raise ParcelServiceError("PROVIDER_NOT_CONFIGURED", "필지별 용도지역 조회를 위해 서버에 VWORLD_API_KEY를 설정해 주세요.", 503)
    parcel = fetch_parcel(pnu)
    bbox = _parcel_bbox(parcel)
    checked_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    deadline = time.monotonic() + _SEARCH_BUDGET
    warnings = ["용도지역·지구단위계획 구역의 공간자료 조회입니다. 개별 계획 고시·시행지침의 건폐율·용적률·높이 상한은 확정하지 않았습니다.",
        "교차면적은 WGS84를 공통 지역 평면으로 근사 투영한 값이며 공부 면적이나 인허가 기준 면적을 대체하지 않습니다."]
    layer_results = {}
    errors = {}
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="parcel-regulations") as pool:
        jobs = {pool.submit(_regulation_features, layer, bbox, deadline): layer for layer, _title, _kind, _slug in _REGULATION_LAYERS}
        for future in as_completed(jobs):
            layer = jobs[future]
            try:
                layer_results[layer] = future.result()
            except ParcelServiceError as exc:
                errors[layer] = exc.code
            except Exception:
                # Never expose exception strings: a provider transport error
                # may contain a credential-bearing URL.
                errors[layer] = "UPSTREAM_UNAVAILABLE"
    groups = []
    sources = []
    complete = not errors
    for layer, title, kind, _slug in _REGULATION_LAYERS:
        sources.append({"title": f"브이월드 {title} ({layer})",
            "url": "https://api.vworld.kr/req/data", "checkedAt": checked_at})
        if layer in errors:
            warnings.append(f"{title} 자료를 조회하지 못했습니다 ({errors[layer]}). 결과 없음으로 확정하지 않았습니다.")
            continue
        features, layer_complete = layer_results[layer]
        if not layer_complete:
            complete = False
            warnings.append(f"{title} 응답이 일부 자료만 포함하여 전체 분포를 확정하지 않았습니다.")
        try:
            found, missing_names = _regulation_groups(features, layer, kind)
            groups.extend(found)
            if missing_names:
                complete = False
                warnings.append(f"{title}의 공식 명칭 속성이 없는 경계는 명칭을 추정하지 않았습니다.")
        except ParcelServiceError:
            complete = False
            warnings.append(f"{title} 경계 형식을 검증하지 못하여 해당 레이어를 적용하지 않았습니다.")
    zones, district_plans = [], []
    intersection_done = False
    try:
        intersection = _intersection_areas(parcel, groups)
        intersection_done = True
        parcel_area = intersection["parcelAreaSqm"]
        for group, area in zip(groups, intersection["areas"]):
            if area <= 0.0001:
                continue
            item = {**group["item"], "intersectionAreaSqm": round(area, 4)}
            if group["kind"] == "zone":
                item["coveragePct"] = round(min(100.0, max(0.0, 100.0 * area / parcel_area)), 6)
                zones.append(item)
            else:
                district_plans.append(item)
        covered = intersection["zoningCoverageAreaSqm"]
        if covered / parcel_area < 0.995:
            complete = False
            warnings.append("필지 전체의 용도지역 공간자료가 확인되지 않았습니다. 미확인 부분을 단일 용도지역으로 채우지 않았습니다.")
        if sum(item["intersectionAreaSqm"] for item in zones) > parcel_area * 1.005:
            complete = False
            warnings.append("서로 다른 용도지역 경계가 중복됩니다. 우선순위와 최신 고시를 확인해야 합니다.")
    except ParcelServiceError:
        complete = False
        warnings.append("실제 필지와의 교차면적을 계산하지 못하여 주변 영역을 해당 필지의 지정사항으로 확정하지 않았습니다.")
    if len(zones) > 1:
        warnings.append("필지에 여러 용도지역이 분포합니다. 임의의 한 용도지역이나 단순 평균 용적률로 자동 확정하지 않습니다.")
    if district_plans:
        warnings.append("지구단위계획 구역과 교차합니다. 구역 존재만으로 개별 계획의 건폐율·용적률·높이·허용용도를 확정할 수 없어 원문 고시 확인이 필요합니다.")
    return {"pnu": pnu, "status": "verified" if complete and intersection_done and zones else "partial" if zones or district_plans else "unverified",
        "zones": zones, "districtPlans": district_plans,
        "limits": {"farPct": None, "bcrPct": None, "heightM": None},
        "sources": sources, "checkedAt": checked_at, "warnings": warnings}


def _context_input(pnus, radius_m) -> tuple[list, float]:
    if (not isinstance(pnus, (list, tuple)) or not 1 <= len(pnus) <= 5
            or any(not _pnu(value) for value in pnus)):
        raise ParcelServiceError("INVALID_PNUS", "주변 공간자료는 실제 PNU 1~5개를 지정해 조회해 주세요.", 400)
    try:
        radius = float(radius_m)
    except (ValueError, TypeError, OverflowError):
        radius = float("nan")
    if isinstance(radius_m, bool) or not math.isfinite(radius) or not 20 <= radius <= 300:
        raise ParcelServiceError("INVALID_RADIUS", "주변 공간자료 조회 여유 범위는 20~300m입니다.", 400)
    return list(dict.fromkeys(pnus)), radius


def _context_bbox(parcels: list, radius: float) -> tuple:
    boxes = [_parcel_bbox(parcel) for parcel in parcels]
    base = (min(b[0] for b in boxes), min(b[1] for b in boxes),
        max(b[2] for b in boxes), max(b[3] for b in boxes))
    sx = 111320 * math.cos(math.radians((base[1] + base[3]) / 2))
    if max((base[2] - base[0]) * sx, (base[3] - base[1]) * 111320) > 1500:
        raise ParcelServiceError("CONTEXT_EXTENT_TOO_LARGE", "선택 필지 사이 거리가 커서 주변 공간자료를 한 번에 조회할 수 없습니다.", 400)
    box = (base[0] - radius / sx, base[1] - radius / 111320,
        base[2] + radius / sx, base[3] + radius / 111320)
    if not (124 <= box[0] < box[2] <= 132 and 33 <= box[1] < box[3] <= 39):
        raise ParcelServiceError("INVALID_CONTEXT_EXTENT", "주변 공간자료 조회 범위가 지원 좌표 범위를 벗어났습니다.", 400)
    return box


def _context_features(layer: str, bbox: tuple, deadline: float) -> tuple[list, bool, int | None]:
    """Bounded, server-owned Data API queries; never accept a caller's layer/URL."""
    if layer not in {item[0] for item in _CONTEXT_LAYERS}:
        raise ParcelServiceError("INVALID_LAYER", "지원하지 않는 주변 공간자료 레이어입니다.", 400)
    collected, reported_total, complete = [], None, False
    max_pages = _MAX_CONTEXT_FEATURES // _CONTEXT_PAGE_SIZE
    for page_number in range(1, max_pages + 1):
        response = _vworld("vworld_data", {"service": "data", "request": "GetFeature", "data": layer,
            "geomFilter": f"BOX({bbox[0]:.9f},{bbox[1]:.9f},{bbox[2]:.9f},{bbox[3]:.9f})",
            "crs": "EPSG:4326", "geometry": "true", "attribute": "true",
            "size": _CONTEXT_PAGE_SIZE, "page": page_number}, deadline)
        if response["status"] == "NOT_FOUND":
            return collected, not collected, 0 if not collected else reported_total
        result = response.get("result")
        collection = result.get("featureCollection") if isinstance(result, dict) else None
        if not isinstance(collection, dict) or not isinstance(collection.get("features"), list):
            raise ParcelServiceError("UPSTREAM_FORMAT", "주변 공간자료의 경계 목록 형식을 확인할 수 없습니다.", 502)
        features = collection["features"]
        if len(features) > _CONTEXT_PAGE_SIZE:
            raise ParcelServiceError("UPSTREAM_TOO_LARGE", "주변 공간자료의 경계 수가 요청 범위를 초과했습니다.", 502)
        collected.extend(features)
        record = response.get("record") if isinstance(response.get("record"), dict) else {}
        page = response.get("page") if isinstance(response.get("page"), dict) else {}
        try:
            if any(isinstance(value, bool) or not isinstance(value, (int, str))
                    or not re.fullmatch(r"[0-9]{1,9}", str(value))
                    for value in (record.get("total"), page.get("total"), page.get("current"))):
                raise ValueError("invalid pagination")
            total, pages = int(record["total"]), int(page["total"])
            current = int(page["current"])
            if total < len(collected) or pages < 1 or current != page_number:
                raise ValueError("inconsistent pagination")
            if reported_total is not None and reported_total != total:
                return collected, False, max(reported_total, total)
            reported_total = total
            complete = len(collected) >= total and page_number >= pages
        except (KeyError, ValueError, TypeError, OverflowError):
            return collected, False, reported_total
        if complete or not features:
            break
    return collected, complete, reported_total


def _context_geometry(value, counter: list, kind: str) -> dict:
    if kind != "road-centerline":
        return _geometry(value, counter, _MAX_CONTEXT_COORDINATES)
    if not isinstance(value, dict) or value.get("type") not in ("LineString", "MultiLineString"):
        raise ParcelServiceError("INVALID_GEOMETRY", "도로 중심선의 기하 형식을 확인할 수 없습니다.", 502)
    coordinates = value.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise ParcelServiceError("INVALID_GEOMETRY", "도로 중심선 좌표가 없습니다.", 502)
    lines = [coordinates] if value["type"] == "LineString" else coordinates
    for line in lines:
        if not isinstance(line, list) or len(line) < 2:
            raise ParcelServiceError("INVALID_GEOMETRY", "도로 중심선 좌표가 부족합니다.", 502)
        for coordinate in line:
            counter[0] += 1
            if counter[0] > _MAX_CONTEXT_COORDINATES:
                raise ParcelServiceError("INVALID_GEOMETRY", "주변 공간자료 좌표 수가 지원 범위를 초과했습니다.", 502)
            if (not isinstance(coordinate, list) or len(coordinate) != 2
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in coordinate)
                    or not (124 <= coordinate[0] <= 132 and 33 <= coordinate[1] <= 39)):
                raise ParcelServiceError("INVALID_GEOMETRY", "도로 중심선의 EPSG:4326 좌표를 확인할 수 없습니다.", 502)
        if all(point == line[0] for point in line[1:]):
            raise ParcelServiceError("INVALID_GEOMETRY", "길이가 없는 도로 중심선입니다.", 502)
    return {"type": value["type"], "coordinates": copy.deepcopy(coordinates)}


def _context_properties(props: dict, layer: str, kind: str, selected: set) -> dict:
    clean = {"layer": layer, "source": "vworld", "kind": kind}
    if kind == "cadastral":
        pnu = _pnu(props.get("pnu"))
        if not pnu:
            raise ParcelServiceError("PNU_MISMATCH", "주변 필지의 PNU를 확인할 수 없습니다.", 502)
        clean.update({"pnu": pnu, "selected": pnu in selected})
        fields = (("addr", "address"), ("jibun", "jibun"), ("gosi_year", "noticeYear"), ("gosi_month", "noticeMonth"))
    elif kind == "road-centerline":
        clean.update({"widthM": None, "widthVerified": False, "physicalBoundaryVerified": False})
        fields = (("rn", "name"),) if layer == "LT_L_SPRD" else (("rdnm", "name"), ("ufid", "providerId"))
        allowed = ("rn", "rn_cd", "road_bt", "road_lt") if layer == "LT_L_SPRD" else ("ufid", "rdnu", "rddv", "rdln", "rvwd", "rdnm", "scls", "dvyn", "onsd")
        # Original provider values are retained as strings, with no unit or
        # regulatory interpretation. In particular rvwd is not legal road width.
        clean["attributes"] = {key: _text(str(props[key]), 120) for key in allowed
            if key in props and isinstance(props[key], (str, int, float)) and not isinstance(props[key], bool)
            and (not isinstance(props[key], float) or math.isfinite(props[key]))}
    else:
        clean["planned"] = True
        fields = (("dgm_nm", "name"), ("present_sn", "providerId"), ("ntfc_sn", "noticeId"),
            ("grad_se", "roadClass"), ("exc_nam", "executionStatus"))
    for original, canonical in fields:
        value = _text(props.get(original), 300)
        if value:
            clean[canonical] = value
    return clean


def _canonical_context(features: list, layer: str, kind: str, pnus: list, bbox: tuple) -> tuple[list, int]:
    canonical, skipped, seen, counter = [], 0, set(), [0]
    for feature in features:
        try:
            if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
                raise ParcelServiceError("UPSTREAM_FORMAT", "주변 공간자료 속성 형식 오류입니다.", 502)
            geometry = _context_geometry(feature.get("geometry"), counter, kind)
            # Retain source geometry, including holes/parts. The frontend clips
            # rendering to bbox; a long road must not redefine the site's origin.
            if geometry["type"] in ("Polygon", "MultiPolygon"):
                gb = _parcel_bbox({"features": [{"geometry": geometry}]})
            else:
                lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
                points = [point for line in lines for point in line]
                gb = (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))
            if gb[2] < bbox[0] or gb[0] > bbox[2] or gb[3] < bbox[1] or gb[1] > bbox[3]:
                raise ParcelServiceError("INVALID_GEOMETRY", "조회 범위 밖의 공간자료입니다.", 502)
            item = {"type": "Feature", "geometry": geometry,
                "properties": _context_properties(feature["properties"], layer, kind, set(pnus))}
            identity = json.dumps(item, sort_keys=True, ensure_ascii=True, allow_nan=False)
            if identity not in seen:
                seen.add(identity)
                canonical.append(item)
        except ParcelServiceError:
            skipped += 1
    return canonical, skipped


def fetch_parcel_context(pnus, radius_m=120) -> dict:
    """Actual cadastral/road GIS context in one EPSG:4326 coordinate system.

    No procedural fallback, map tiles, browser credential or inferred road width
    is returned. Source geometry is not a survey or statutory road assessment.
    """
    pnus, radius = _context_input(pnus, radius_m)
    if not _key("VWORLD_API_KEY"):
        raise ParcelServiceError("PROVIDER_NOT_CONFIGURED", "주변 공간자료 조회를 위해 서버에 VWORLD_API_KEY를 설정해 주세요.", 503)
    deadline = time.monotonic() + _SEARCH_BUDGET
    with ThreadPoolExecutor(max_workers=len(pnus), thread_name_prefix="context-parcels") as pool:
        parcels = list(pool.map(fetch_parcel, pnus))
    bbox = _context_bbox(parcels, radius)
    checked_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="parcel-context") as pool:
        jobs = {pool.submit(_context_features, layer, bbox, deadline): layer for layer, _title, _kind in _CONTEXT_LAYERS}
        for future in as_completed(jobs):
            layer = jobs[future]
            try:
                results[layer] = future.result()
            except ParcelServiceError as exc:
                errors[layer] = exc.code
            except Exception:
                errors[layer] = "UPSTREAM_UNAVAILABLE"
    collections = {key: {"type": "FeatureCollection", "features": []} for key in ("parcels", "roads", "plannedRoads")}
    layers = []
    warnings = ["도로 중심선과 도시계획도로는 실제 도로 경계·현황 폭·건축법상 도로 지정 여부를 확정하지 않습니다.",
        "원본 EPSG:4326 기하를 공통 좌표로 제공합니다. 주변 도형이 길게 이어져도 선택 필지의 기준점·방향·배치 위치를 바꾸지 마세요."]
    for layer, title, kind in _CONTEXT_LAYERS:
        source = {"title": f"브이월드 {title} ({layer})", "url": _ENDPOINTS["vworld_data"], "checkedAt": checked_at}
        summary = {"id": layer, "title": title, "kind": kind, "featureCount": 0, "totalCount": None, "complete": False, "source": source}
        if layer in errors:
            summary.update({"status": "unavailable", "errorCode": errors[layer]})
            warnings.append(f"{title} 자료를 조회하지 못했습니다 ({errors[layer]}). 실제 자료 없음으로 확정하거나 예시 도형으로 대체하지 않았습니다.")
        else:
            raw, complete, total = results[layer]
            features, skipped = _canonical_context(raw, layer, kind, pnus, bbox)
            complete = complete and not skipped
            summary.update({"featureCount": len(features), "totalCount": total, "complete": complete,
                "status": "partial" if not complete else "available" if features else "empty"})
            target = "parcels" if kind == "cadastral" else "roads" if kind == "road-centerline" else "plannedRoads"
            collections[target]["features"].extend(features)
            if not complete:
                warnings.append(f"{title} 자료가 일부 누락되거나 형식을 검증하지 못했습니다. 전체 현황으로 확정하지 않았습니다.")
        layers.append(summary)
    return {"version": 1, "source": "vworld", "crs": "EPSG:4326", "pnus": pnus, "radiusM": radius,
        "bbox": list(bbox), "checkedAt": checked_at, "selectedParcels": {"type": "FeatureCollection",
            "features": [{**feature, "properties": {**feature["properties"], "layer": "LP_PA_CBND_BUBUN",
                "kind": "cadastral", "selected": True}} for parcel in parcels for feature in parcel["features"]]},
        **collections, "layers": layers, "warnings": warnings}
