#!/usr/bin/env python3
"""
Korean Statutory Area, Zoning (BCR/FAR via Live Law.go.kr API) & Municipal Parking Calculator
(kr_area_parking_calculator.py)

1. Connects LIVE to the Ministry of Government Legislation (법제처 국가법령정보센터, OC=wanhee)
   Open API to retrieve and parse:
   - 「국토의 계획 및 이용에 관한 법률 시행령」 제84조(건폐율) · 제85조(용적률) 법정상한
   - 「서울특별시 도시계획 조례」 (MST 2149501, 시행 2026.7.13)
     * 제44조 (용도지역 안에서의 건폐율)
     * 제48조 (용도지역 안에서의 용적률 — 서울도심 단서조항 포함)
     * 제50조 (용적률의 강화 — 상업지역 주거복합, 준공업지역 공동주택 250%)
     * 제51조 (용적률의 완화 — 공공시설 기부채납 (1+1.3α)×조례용적률 등)
2. Computes the 8 Korean statutory & commercial area metrics per 「건축법 시행령」 제119조.
3. Preserves legacy parking / basement arithmetic as unverified assumptions.
   It does not establish statutory caps, parking or parcel compliance. Use the
   reviewed shared app engine and verified floor-by-floor evidence separately.
"""

import argparse
import datetime
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

PYEONG_FACTOR = 3.305785
DEFAULT_OC = os.environ.get("LAW_OC", "wanhee")
BASE_SEARCH_URL = "http://www.law.go.kr/DRF/lawSearch.do"
BASE_SERVICE_URL = "http://www.law.go.kr/DRF/lawService.do"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# Zone key aliases so both short keys and full names work seamlessly
ZONE_ALIASES = {
    "type1_exclusive_residential": "res_exclusive_1",
    "type2_exclusive_residential": "res_exclusive_2",
    "type1_general_residential": "res_general_1",
    "type2_general_residential": "res_general_2",
    "type3_general_residential": "res_general_3",
}

# Fallback & National Ceiling (국토계획법 시행령 제84조·제85조) vs Seoul Ordinance (서울시 도시계획조례 제44조·제48조)
ZONING_TABLE = {
    "res_exclusive_1": {
        "name_kr": "제1종전용주거지역",
        "national": {"bcr": 50.0, "far": 100.0},
        "seoul": {"bcr": 50.0, "far": 100.0, "far_downtown": 100.0},
        "busan": {"bcr": 50.0, "far": 100.0},
    },
    "res_exclusive_2": {
        "name_kr": "제2종전용주거지역",
        "national": {"bcr": 50.0, "far": 150.0},
        "seoul": {"bcr": 40.0, "far": 120.0, "far_downtown": 120.0},
        "busan": {"bcr": 50.0, "far": 150.0},
    },
    "res_general_1": {
        "name_kr": "제1종일반주거지역",
        "national": {"bcr": 60.0, "far": 200.0},
        "seoul": {"bcr": 60.0, "far": 150.0, "far_downtown": 150.0},
        "busan": {"bcr": 60.0, "far": 180.0},
    },
    "res_general_2": {
        "name_kr": "제2종일반주거지역",
        "national": {"bcr": 60.0, "far": 250.0},
        "seoul": {"bcr": 60.0, "far": 200.0, "far_downtown": 200.0},
        "busan": {"bcr": 60.0, "far": 220.0},
    },
    "res_general_3": {
        "name_kr": "제3종일반주거지역",
        "national": {"bcr": 50.0, "far": 300.0},
        "seoul": {"bcr": 50.0, "far": 250.0, "far_downtown": 250.0},
        "busan": {"bcr": 50.0, "far": 280.0},
    },
    "semi_residential": {
        "name_kr": "준주거지역",
        "national": {"bcr": 70.0, "far": 500.0},
        "seoul": {"bcr": 60.0, "far": 400.0, "far_downtown": 400.0},
        "busan": {"bcr": 60.0, "far": 400.0},
    },
    "central_commercial": {
        "name_kr": "중심상업지역",
        "national": {"bcr": 90.0, "far": 1500.0},
        "seoul": {"bcr": 60.0, "far": 1000.0, "far_downtown": 800.0},
        "busan": {"bcr": 80.0, "far": 1300.0},
    },
    "general_commercial": {
        "name_kr": "일반상업지역",
        "national": {"bcr": 80.0, "far": 1300.0},
        "seoul": {"bcr": 60.0, "far": 800.0, "far_downtown": 600.0},
        "busan": {"bcr": 70.0, "far": 1000.0},
    },
    "neighborhood_commercial": {
        "name_kr": "근린상업지역",
        "national": {"bcr": 70.0, "far": 900.0},
        "seoul": {"bcr": 60.0, "far": 600.0, "far_downtown": 500.0},
        "busan": {"bcr": 70.0, "far": 700.0},
    },
    "semi_industrial": {
        "name_kr": "준공업지역",
        "national": {"bcr": 70.0, "far": 400.0},
        "seoul": {"bcr": 60.0, "far": 400.0, "far_downtown": 400.0},
        "busan": {"bcr": 70.0, "far": 400.0},
    },
}

PARKING_M2_PER_STALL = {
    "office": {"name_kr": "업무시설(오피스)", "national": 200.0, "seoul": 100.0, "busan": 150.0},
    "neighborhood_living": {"name_kr": "제1·2종 근린생활시설", "national": 200.0, "seoul": 134.0, "busan": 150.0},
    "retail": {"name_kr": "판매시설", "national": 150.0, "seoul": 134.0, "busan": 134.0},
    "cultural": {"name_kr": "문화 및 집회시설", "national": 150.0, "seoul": 134.0, "busan": 150.0},
    "hotel": {"name_kr": "숙박시설", "national": 200.0, "seoul": 134.0, "busan": 150.0},
    "medical": {"name_kr": "의료시설", "national": 150.0, "seoul": 150.0, "busan": 150.0},
    "officetel": {"name_kr": "업무시설(오피스텔)", "national": 120.0, "seoul": 100.0, "busan": 120.0},
    "apartment": {"name_kr": "공동주택(아파트)", "national": 85.0, "seoul": 75.0, "busan": 85.0},
}


def to_pyeong(m2: float) -> float:
    return round(m2 / PYEONG_FACTOR, 2)


def _parse_kor_number(text: str) -> float:
    """Convert Korean number strings like '1천' or '800' to float (1000.0, 800.0)."""
    t = text.strip().replace(",", "")
    if "1천" in t or "일천" in t:
        return 1000.0
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    return float(m.group(1)) if m else 0.0


def fetch_live_seoul_ordinance_bcr_far(oc: str = DEFAULT_OC, timeout: int = 12) -> dict:
    """
    Queries Ministry of Government Legislation (law.go.kr) Open API live for
    「서울특별시 도시계획 조례」 and parses:
    - 용도지역 안에서의 건폐율 (제44조)
    - 용도지역 안에서의 용적률 (제48조, including 서울도심 proviso)
    - 용적률의 강화 (제50조) & 용적률의 완화 (제51조)
    """
    search_params = urllib.parse.urlencode({
        "OC": oc,
        "target": "ordin",
        "type": "XML",
        "query": "서울특별시 도시계획 조례",
        "display": "30",
    })
    req = urllib.request.Request(
        f"{BASE_SEARCH_URL}?{search_params}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/xml"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        s_root = ET.fromstring(resp.read().decode("utf-8", errors="replace"))

    mst = None
    eff_date = None
    ordin_name = "서울특별시 도시계획 조례"
    for node in s_root.findall(".//law"):
        name = (node.findtext("자치법규명") or "").strip()
        if name == "서울특별시 도시계획 조례":
            mst = node.findtext("자치법규일련번호")
            eff_date = node.findtext("시행일자")
            break

    if not mst:
        raise ValueError("서울특별시 도시계획 조례 MST not found on law.go.kr")

    svc_params = urllib.parse.urlencode({
        "OC": oc,
        "target": "ordin",
        "type": "XML",
        "MST": mst,
    })
    svc_req = urllib.request.Request(
        f"{BASE_SERVICE_URL}?{svc_params}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/xml"},
    )
    with urllib.request.urlopen(svc_req, timeout=timeout) as resp:
        root = ET.fromstring(resp.read().decode("utf-8", errors="replace"))

    bcr_article_no = ""
    bcr_text = ""
    far_article_no = ""
    far_text = ""
    far_strengthen_text = ""
    far_relax_text = ""

    for unit in root.findall(".//조"):
        title = (unit.findtext("조제목") or "").strip()
        content = (unit.findtext("조내용") or "").strip()
        if title == "용도지역 안에서의 건폐율":
            m_no = re.match(r"(제\d+조)", content)
            bcr_article_no = m_no.group(1) if m_no else "제44조"
            bcr_text = content
        elif title == "용도지역 안에서의 용적률":
            m_no = re.match(r"(제\d+조)", content)
            far_article_no = m_no.group(1) if m_no else "제48조"
            far_text = content
        elif title == "용적률의 강화" and not far_strengthen_text:
            far_strengthen_text = content
        elif title == "용적률의 완화" and not far_relax_text:
            far_relax_text = content

    if not bcr_text or not far_text or not bcr_article_no or not far_article_no:
        raise ValueError("Required zoning articles were not retrieved; static values are not verified live law.")
    parsed_zones = {}
    for z_key, z_meta in ZONING_TABLE.items():
        z_name = z_meta["name_kr"]
        bcr_val = z_meta["seoul"]["bcr"]
        far_val = z_meta["seoul"]["far"]
        far_dt_val = z_meta["seoul"]["far_downtown"]

        # Parse BCR from 제44조 text: e.g. "8. 일반상업지역: 60퍼센트"
        m_bcr = re.search(rf"{re.escape(z_name)}\s*:\s*([0-9천]+)\s*퍼센트", bcr_text)
        if m_bcr:
            bcr_val = _parse_kor_number(m_bcr.group(1))

        # Parse FAR from 제48조 text: e.g. "7. 중심상업지역: 1천퍼센트(단, 서울도심: 800퍼센트)"
        m_far = re.search(
            rf"{re.escape(z_name)}\s*:\s*([0-9천]+)\s*퍼센트(?:\(단,\s*서울도심\s*:\s*([0-9천]+)\s*퍼센트\))?",
            far_text,
        )
        if m_far:
            far_val = _parse_kor_number(m_far.group(1))
            if m_far.group(2):
                far_dt_val = _parse_kor_number(m_far.group(2))
        downtown_needed = z_meta["seoul"]["far_downtown"] != z_meta["seoul"]["far"]
        matched = bool(m_bcr and m_far and (not downtown_needed or m_far.group(2)))

        parsed_zones[z_name] = {
            "zone_key": z_key,
            "bcr_pct": bcr_val,
            "far_pct": far_val,
            "far_seoul_downtown_pct": far_dt_val,
            "national_bcr_pct": z_meta["national"]["bcr"],
            "national_far_pct": z_meta["national"]["far"],
            "bcr_article": bcr_article_no,
            "far_article": far_article_no,
            "verification_status": "PARSED_OFFICIAL_TEXT" if matched else "NEEDS_VERIFICATION",
            "bcr_source": "parsed-official-text" if m_bcr else "static-reference-assumption",
            "far_source": "parsed-official-text" if m_far else "static-reference-assumption",
            "downtown_source": "parsed-official-text" if m_far and m_far.group(2) else "static-reference-assumption" if downtown_needed else "not-separate-in-reference",
        }

    if not any(row["verification_status"] == "PARSED_OFFICIAL_TEXT" for row in parsed_zones.values()):
        raise ValueError("No zoning rule was fully parsed; static values are not verified live law.")
    return {
        "status": "VERIFIED_LIVE" if all(row["verification_status"] == "PARSED_OFFICIAL_TEXT" for row in parsed_zones.values()) else "PARTIAL_LIVE_REFERENCE",
        "scope": "Source text retrieval only; parcel applicability and incentives are not verified.",
        "oc_used": oc,
        "ordinance_name": ordin_name,
        "mst": mst,
        "effective_date": eff_date,
        "bcr_article_no": bcr_article_no,
        "far_article_no": far_article_no,
        "bcr_article_text": bcr_text,
        "far_article_text": far_text,
        "far_strengthen_excerpt": far_strengthen_text[:600],
        "far_relax_excerpt": far_relax_text[:600],
        "zones": parsed_zones,
        "api_endpoint": f"{BASE_SERVICE_URL}?{svc_params}",
    }


def calculate(args):
    today = datetime.date.today().isoformat()
    zone_key = ZONE_ALIASES.get(args.zone, args.zone)
    zone_info = ZONING_TABLE[zone_key]
    zone_name_kr = zone_info["name_kr"]

    cadastral_area = args.site_area
    road_setback = args.road_setback_area
    public_contrib_area = args.public_contribution_area
    buildable_site_area = max(0.0, cadastral_area - road_setback - public_contrib_area)

    reg_key = args.region if args.region in ("seoul", "busan") else "national"
    nat_limits = zone_info["national"]
    ord_limits = zone_info.get(reg_key, nat_limits)

    # Live Law.go.kr lookup when region == seoul and --live-law is enabled
    live_law_meta = None
    bcr_article_ref = "제44조"
    far_article_ref = "제48조"
    if reg_key == "seoul" and not args.offline:
        try:
            live_data = fetch_live_seoul_ordinance_bcr_far(oc=args.oc)
            live_law_meta = {
                "status": live_data["status"],
                "ordinance_name": live_data["ordinance_name"],
                "mst": live_data["mst"],
                "effective_date": live_data["effective_date"],
                "bcr_article_no": live_data["bcr_article_no"],
                "far_article_no": live_data["far_article_no"],
                "api_endpoint": live_data["api_endpoint"],
                "zone_verification_status": live_data["zones"].get(zone_name_kr, {}).get("verification_status", "NEEDS_VERIFICATION"),
            }
            bcr_article_ref = live_data["bcr_article_no"]
            far_article_ref = live_data["far_article_no"]
            if zone_name_kr in live_data["zones"]:
                lz = live_data["zones"][zone_name_kr]
                ord_limits = {
                    "bcr": lz["bcr_pct"],
                    "far": lz["far_seoul_downtown_pct"] if args.seoul_downtown else lz["far_pct"],
                }
        except Exception as exc:
            live_law_meta = {"status": "FALLBACK_STATIC", "reason": str(exc)}
            if args.seoul_downtown and "far_downtown" in ord_limits:
                ord_limits = {"bcr": ord_limits["bcr"], "far": ord_limits["far_downtown"]}
    else:
        if args.seoul_downtown and "far_downtown" in ord_limits:
            ord_limits = {"bcr": ord_limits["bcr"], "far": ord_limits["far_downtown"]}

    base_max_bcr_pct = args.ordinance_bcr_limit if args.ordinance_bcr_limit is not None else ord_limits["bcr"]
    base_max_far_pct = args.ordinance_far_limit if args.ordinance_far_limit is not None else ord_limits["far"]

    # Contribution area alone does not establish article 51 eligibility or an
    # approved plan. Keep density arithmetic at the unverified reference value.
    alpha_ratio = (public_contrib_area / buildable_site_area) if (buildable_site_area > 0 and public_contrib_area > 0) else 0.0
    max_far_pct = base_max_far_pct

    max_bcr_pct = base_max_bcr_pct

    target_bcr_pct = args.bcr_pct if args.bcr_pct is not None else max_bcr_pct
    target_far_pct = args.far_pct if args.far_pct is not None else max_far_pct

    # 1. Building Area (건축면적) & FAR-Countable GFA (용적률 산정용 연면적)
    building_area_m2 = buildable_site_area * (target_bcr_pct / 100.0)
    far_countable_gfa_m2 = buildable_site_area * (target_far_pct / 100.0)

    # 2. Exclusive Area (전용면적) vs Core/Floor Common Area (주거/코어공용면적)
    core_ratio = args.core_ratio
    core_common_area_m2 = far_countable_gfa_m2 * core_ratio
    exclusive_area_m2 = far_countable_gfa_m2 * (1.0 - core_ratio)
    supply_area_m2 = exclusive_area_m2 + core_common_area_m2

    # 3. Unit estimation
    estimated_units = None
    if args.avg_exclusive_unit_m2 and args.avg_exclusive_unit_m2 > 0:
        estimated_units = int(exclusive_area_m2 // args.avg_exclusive_unit_m2)

    # 4. Parking Requirement Calculation (부설주차장 설치대수)
    pk_info = PARKING_M2_PER_STALL[args.building_use]
    m2_per_stall = (
        args.parking_m2_per_stall
        if args.parking_m2_per_stall is not None
        else pk_info.get(reg_key, pk_info["national"])
    )

    if args.building_use in ("apartment", "officetel") and estimated_units:
        stalls_by_area = far_countable_gfa_m2 / m2_per_stall
        unit_ratio = 0.8 if args.avg_exclusive_unit_m2 < 60 else 1.0
        stalls_by_unit = estimated_units * unit_ratio
        raw_stalls = max(stalls_by_area, stalls_by_unit)
        parking_basis = f"Max(시설면적/{m2_per_stall:.0f}m2, {estimated_units}세대x{unit_ratio}대)"
    else:
        raw_stalls = far_countable_gfa_m2 / m2_per_stall
        parking_basis = f"시설면적({far_countable_gfa_m2:,.1f}m2) / {m2_per_stall:.1f}m2당 1대"

    required_parking_stalls = max(1, int(math.ceil(raw_stalls))) if args.strict_parking_ceil else int(round(raw_stalls))
    planned_parking_stalls = max(required_parking_stalls, int(math.ceil(required_parking_stalls * args.parking_buffer_ratio)))

    disabled_parking_stalls = math.ceil(planned_parking_stalls * 0.03) if planned_parking_stalls >= 10 else 0
    ev_parking_stalls = math.ceil(planned_parking_stalls * 0.05) if planned_parking_stalls >= 50 else 0

    # 5. Basement Area & Levels
    basement_parking_area_m2 = planned_parking_stalls * args.m2_per_parking_bay
    basement_mep_other_m2 = far_countable_gfa_m2 * args.basement_mep_ratio
    other_common_area_m2 = basement_parking_area_m2 + basement_mep_other_m2
    basement_total_area_m2 = other_common_area_m2

    typical_basement_floor_plate_m2 = buildable_site_area * args.basement_footprint_ratio
    estimated_basement_floors = (
        max(1, int(math.ceil(basement_total_area_m2 / typical_basement_floor_plate_m2)))
        if typical_basement_floor_plate_m2 > 0
        else 0
    )

    # 6. Total GFA & Contract Area
    total_gfa_m2 = far_countable_gfa_m2 + basement_total_area_m2
    contract_area_m2 = supply_area_m2 + other_common_area_m2

    # 7. Landscape Area Requirement (건축법 제42조)
    if total_gfa_m2 >= 2000:
        landscape_ratio_pct = 15.0
    elif total_gfa_m2 >= 1000:
        landscape_ratio_pct = 10.0
    else:
        landscape_ratio_pct = 5.0
    required_landscape_m2 = buildable_site_area * (landscape_ratio_pct / 100.0)

    bcr_compliant = target_bcr_pct <= max_bcr_pct + 0.01
    far_compliant = target_far_pct <= max_far_pct + 0.01

    return {
        "assessment_status": "NEEDS_VERIFICATION",
        "assessment_scope": "LEGACY_REFERENCE_ARITHMETIC_NOT_SHARED_STATUTORY_ENGINE",
        "is_permit_confirmation": False,
        "calculated_at": today,
        "warnings": [
            "이 보조 CLI는 검토된 주 JavaScript 법규 엔진과 별도입니다. 층별 용도·면적, 주택 승인 경로, 제50조 강화 및 주차 조례의 세부 조건을 지원하지 않습니다.",
            "법정 상한·주차대수·장애인·EV·조경 적합을 확정하지 않습니다. 기존 산술값은 illustrative_assumptions에만 보존합니다.",
            "과거 판매시설134㎡·오피스텔100㎡의 면적식, 주거 총면적 분모·세대 구간·Python 반올림, 장애인·EV 개산은 검토된 주 엔진과 다릅니다. 이 숫자를 현행 법정 주차 결과로 사용하지 마세요.",
            "공공기여 면적 입력만으로 용적률 인센티브를 가산하지 않습니다. 계획·지정·승인 조건을 확인해야 합니다.",
            "면적·공급·계약·지하층은 사용자 입력과 과거 개산 가정입니다. 공부·계약서·실제 주차배치 결과가 아닙니다.",
        ],
        "site_summary": {
            "measurement_status": "UNVERIFIED_INPUT_ASSUMPTION",
            "cadastral_area_m2": round(cadastral_area, 2),
            "cadastral_area_pyeong": to_pyeong(cadastral_area),
            "road_setback_excluded_m2": round(road_setback, 2),
            "public_contribution_excluded_m2": round(public_contrib_area, 2),
            "public_contribution_alpha": round(alpha_ratio, 4),
            "buildable_site_area_m2": round(buildable_site_area, 2),
            "buildable_site_area_pyeong": to_pyeong(buildable_site_area),
        },
        "zoning_and_density": {
            "zone_code": zone_key,
            "zone_name_kr": zone_name_kr,
            "region": args.region,
            "seoul_downtown_proviso": args.seoul_downtown,
            "national_ceiling_bcr_pct": None,
            "national_ceiling_far_pct": None,
            "base_ordinance_bcr_pct": None,
            "base_ordinance_far_pct": None,
            "ordinance_limit_bcr_pct": None,
            "ordinance_limit_far_pct": None,
            "ordinance_articles_applied": None,
            "planned_bcr_pct": round(target_bcr_pct, 2),
            "planned_far_pct": round(target_far_pct, 2),
            "bcr_status": "NEEDS_VERIFICATION",
            "far_status": "NEEDS_VERIFICATION",
            "district_unit_plan_status": "NEEDS_VERIFICATION",
            "ground_floors": args.ground_floors,
            "estimated_basement_floors": estimated_basement_floors,
            "live_law_api_sync": live_law_meta,
        },
        "korean_8_area_table": {
            "measurement_status": "ASSUMED",
            "1_buildable_site_area_m2": round(buildable_site_area, 2),
            "2_building_footprint_area_m2": round(building_area_m2, 2),
            "3_typical_ground_floor_plate_m2": round(far_countable_gfa_m2 / max(1, args.ground_floors), 2),
            "4_far_countable_gfa_m2": round(far_countable_gfa_m2, 2),
            "4_far_countable_gfa_pyeong": to_pyeong(far_countable_gfa_m2),
            "5_total_gfa_including_basement_m2": round(total_gfa_m2, 2),
            "5_total_gfa_including_basement_pyeong": to_pyeong(total_gfa_m2),
            "6_exclusive_area_m2": round(exclusive_area_m2, 2),
            "6_exclusive_area_pyeong": to_pyeong(exclusive_area_m2),
            "7a_core_common_area_m2": round(core_common_area_m2, 2),
            "7b_other_common_basement_area_m2": round(other_common_area_m2, 2),
            "8a_supply_area_m2": round(supply_area_m2, 2),
            "8a_supply_area_pyeong": to_pyeong(supply_area_m2),
            "8b_contract_area_m2": round(contract_area_m2, 2),
            "8b_contract_area_pyeong": to_pyeong(contract_area_m2),
            "efficiency_exclusive_to_supply_pct": round((exclusive_area_m2 / supply_area_m2) * 100.0, 2) if supply_area_m2 > 0 else 0.0,
            "efficiency_exclusive_to_contract_pct": round((exclusive_area_m2 / contract_area_m2) * 100.0, 2) if contract_area_m2 > 0 else 0.0,
            "estimated_units": estimated_units,
        },
        "parking_and_landscape": {
            "status": "NEEDS_VERIFICATION",
            "building_use": args.building_use,
            "building_use_kr": pk_info["name_kr"],
            "calculation_basis": "검증되지 않은 과거 개산 산술; illustrative_assumptions 참조",
            "statutory_required_stalls": None,
            "planned_stalls": planned_parking_stalls,
            "planned_stalls_status": "ILLUSTRATIVE_ASSUMPTION_NOT_LAYOUT_CAPACITY",
            "disabled_stalls_min": None,
            "ev_charging_stalls_min": None,
            "basement_parking_area_m2": round(basement_parking_area_m2, 2),
            "basement_mep_area_m2": round(basement_mep_other_m2, 2),
            "required_landscape_ratio_pct": None,
            "required_landscape_area_m2": None,
        },
        "illustrative_assumptions": {
            "status": "UNVERIFIED_LEGACY_ARITHMETIC",
            "national_reference_bcr_pct": nat_limits["bcr"],
            "national_reference_far_pct": nat_limits["far"],
            "density_reference_bcr_pct": base_max_bcr_pct,
            "density_reference_far_pct": base_max_far_pct,
            "incentive_applied": False,
            "input_district_plan_status": args.district_plan_status,
            "parking_basis": parking_basis,
            "legacy_parking_arithmetic_count": required_parking_stalls,
            "disabled_arithmetic_count": disabled_parking_stalls,
            "ev_arithmetic_count": ev_parking_stalls,
            "landscape_assumed_ratio_pct": landscape_ratio_pct,
            "landscape_assumed_area_m2": round(required_landscape_m2, 2),
        },
        "evidence_records": [
            {
                "source_name": f"서울특별시 도시계획 조례 {bcr_article_ref}(건폐율)·{far_article_ref}(용적률) 및 건축법 시행령 제119조",
                "issuing_authority": "서울특별시 / 법제처 국가법령정보센터 (OC=" + args.oc + ")",
                "reference_date": (live_law_meta or {}).get("effective_date"),
                "retrieved_at": today if live_law_meta and "mst" in live_law_meta else None,
                "calculated_at": today,
                "spatial_unit": args.region.upper(),
                "verification_status": "NEEDS_VERIFICATION",
                "source_text_status": (live_law_meta or {}).get("status", "NOT_RETRIEVED"),
                "api_endpoint": (live_law_meta or {}).get("api_endpoint", ""),
            }
        ],
    }


def format_output(res):
    s = res["site_summary"]
    z = res["zoning_and_density"]
    a = res["korean_8_area_table"]
    p = res["parking_and_landscape"]

    lines = [
        "=== 한국 면적 보조 산술 — 법정 상한·주차·적합 판정 미수행 ===",
        f"Zoning District:        {z['zone_name_kr']} ({z['region'].upper()})" + (" [서울도심 특례]" if z.get("seoul_downtown_proviso") else ""),
        "적용 법령·계획조건:     추가 확인 필요 (조회한 원문과 필지별 적용 판단은 별도)",
        f"Law.go.kr Live Sync:    MST={(z.get('live_law_api_sync') or {}).get('mst', 'N/A')} (시행일={(z.get('live_law_api_sync') or {}).get('effective_date', 'N/A')})",
        f"Buildable Site Area:    {s['buildable_site_area_m2']:,.2f} m2 ({s['buildable_site_area_pyeong']:,.2f} 평)",
        "-------------------------------------------------------------------------",
        f"BCR (입력 건폐율):      {z['planned_bcr_pct']:.2f}% · 법정 상한 추가 확인 필요",
        f"FAR (입력 용적률):      {z['planned_far_pct']:.2f}% · 법정 상한 추가 확인 필요",
        f"Scale (규모):           지하 {z['estimated_basement_floors']}층 / 지상 {z['ground_floors']}층",
        "-------------------------------------------------------------------------",
        "[면적 산술표 — 사용자 입력·전용률·지하층 개산 가정]",
        f"1. 대지면적 (Buildable Site):       {a['1_buildable_site_area_m2']:>10,.2f} m2",
        f"2. 건축면적 (Building Footprint):   {a['2_building_footprint_area_m2']:>10,.2f} m2",
        f"3. 지상 기준층 바닥면적 (Avg Plate): {a['3_typical_ground_floor_plate_m2']:>10,.2f} m2",
        f"4. 용적률 산정용 연면적 (FAR GFA):   {a['4_far_countable_gfa_m2']:>10,.2f} m2 ({a['4_far_countable_gfa_pyeong']:,.2f} 평)",
        f"5. 총연면적 (Total GFA w/ Bsmt):    {a['5_total_gfa_including_basement_m2']:>10,.2f} m2 ({a['5_total_gfa_including_basement_pyeong']:,.2f} 평)",
        f"6. 전용면적 (Exclusive Area):       {a['6_exclusive_area_m2']:>10,.2f} m2 ({a['6_exclusive_area_pyeong']:,.2f} 평)",
        f"7a. 코어/주거공용면적 (Core Common): {a['7a_core_common_area_m2']:>10,.2f} m2",
        f"7b. 기타공용/지하주차장 (Other/Bsmt):{a['7b_other_common_basement_area_m2']:>10,.2f} m2",
        f"8a. 공급면적 (Supply Area):         {a['8a_supply_area_m2']:>10,.2f} m2 ({a['8a_supply_area_pyeong']:,.2f} 평) [전용률 {a['efficiency_exclusive_to_supply_pct']:.1f}%]",
        f"8b. 계약면적 (Contract Area):       {a['8b_contract_area_m2']:>10,.2f} m2 ({a['8b_contract_area_pyeong']:,.2f} 평) [전용률 {a['efficiency_exclusive_to_contract_pct']:.1f}%]",
        "-------------------------------------------------------------------------",
        f"[부설주차장 및 조경 산정 ({p['building_use_kr']})]",
        f"산정 기준:              {p['calculation_basis']}",
        f"법정 주차대수:          미확인 (지하 면적용 개산 가정: {p['planned_stalls']} 대, 실제 배치 수용량 아님)",
    ]
    return "\n".join(lines)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    all_zone_choices = list(ZONING_TABLE.keys()) + list(ZONE_ALIASES.keys())

    parser = argparse.ArgumentParser(
        description="Korean Statutory Area, Zoning (Law.go.kr Live) & Municipal Parking Calculator"
    )
    parser.add_argument("--site-area", type=float, default=1000.0, help="Cadastral site area (공부상 토지면적, m2)")
    parser.add_argument("--road-setback-area", type=float, default=0.0, help="Road setback excluded area (도로후퇴 제척면적, m2)")
    parser.add_argument("--public-contribution-area", type=float, default=0.0, help="Public contribution area assumption in m2; no automatic FAR incentive")
    parser.add_argument("--zone", choices=all_zone_choices, default="general_commercial", help="Korean zoning district")
    parser.add_argument("--region", choices=["seoul", "busan", "national"], default="seoul", help="Municipality preset")
    parser.add_argument("--seoul-downtown", action="store_true", help="Apply Seoul Downtown (서울도심 한양도성)FAR proviso per 제48조제7호~제10호")
    parser.add_argument("--oc", default=DEFAULT_OC, help="Law.go.kr Open API OC key (default: wanhee)")
    parser.add_argument("--offline", action="store_true", help="Skip live law.go.kr query and use fallback table")
    parser.add_argument("--dump-live-ordinance", action="store_true", help="Retrieve ordinance text and distinguish parsed / static-reference zoning values")
    parser.add_argument("--ordinance-bcr-limit", type=float, default=None, help="Override ordinance BCR limit (%)")
    parser.add_argument("--ordinance-far-limit", type=float, default=None, help="Override ordinance FAR limit (%)")
    parser.add_argument("--bcr-pct", type=float, default=None, help="Planned BCR (%)")
    parser.add_argument("--far-pct", type=float, default=None, help="Planned FAR (%)")
    parser.add_argument("--ground-floors", type=int, default=10, help="Planned above-ground stories")
    parser.add_argument("--core-ratio", type=float, default=0.22, help="Above-ground core/common ratio (0-1, default 0.22)")
    parser.add_argument("--building-use", choices=list(PARKING_M2_PER_STALL.keys()), default="office", help="Primary building use")
    parser.add_argument("--avg-exclusive-unit-m2", type=float, default=None, help="Avg exclusive area per unit")
    parser.add_argument("--parking-m2-per-stall", type=float, default=None, help="Override m2 of facility area per parking stall")
    parser.add_argument("--parking-buffer-ratio", type=float, default=1.05, help="Ratio of planned parking to statutory minimum")
    parser.add_argument("--m2-per-parking-bay", type=float, default=35.0, help="Gross basement area per parking stall (m2)")
    parser.add_argument("--basement-mep-ratio", type=float, default=0.08, help="Basement MEP area as fraction of FAR GFA")
    parser.add_argument("--basement-footprint-ratio", type=float, default=0.80, help="Basement excavation footprint ratio")
    parser.add_argument("--strict-parking-ceil", action="store_true", help="Always round up fractional parking stalls")
    parser.add_argument("--district-plan-status", default="NEEDS_VERIFICATION", choices=["VERIFIED", "ASSUMED", "NEEDS_VERIFICATION"])
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    if args.dump_live_ordinance:
        live_table = fetch_live_seoul_ordinance_bcr_far(oc=args.oc)
        print(json.dumps(live_table, indent=2, ensure_ascii=False))
        return

    result = calculate(args)

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))


if __name__ == "__main__":
    main()
