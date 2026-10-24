#!/usr/bin/env python3
"""
Seoul 3D Architectural Massing & Real Estate Feasibility Web Server (server.py)
Integrates:
1. Skills-Architects Korean Skills & Calculators (kr_area_parking_calculator,
   kr_egress_calculator, kr_cost_feasibility_calculator, uvalue_calculator, energy_calculator)
2. Ministry of Government Legislation (법제처 국가법령정보센터) Open API via kr_law_lookup.py
   with LAW_OC=wanhee
3. ibuilder/massing-inspired generative 3D massing, S-curve monthly cashflows, XIRR/NPV,
   and Residual Land Value (최대 토지매입가 역산)
4. Seoul S-Map (https://smap.seoul.go.kr/) 3D coordinate & deep-link integration
"""

import http.server
import json
import math
import os
import shutil
import socketserver
import subprocess
import sys
import urllib.parse
import re
from pathlib import Path
import parcel_service
import pilot_security
import study_catalog
import study_archive
from provider_settings import load_settings

load_settings()

PORT = int(os.environ.get("PORT", "8090"))
WEB_DIR = Path(__file__).resolve().parent
SKILLS_ROOT = WEB_DIR / "runtime" / "Skills-Architects" / "skills"
LAW_SCRIPT = SKILLS_ROOT / "country-south-korea" / "scripts" / "kr_law_lookup.py"
AREA_SCRIPT = SKILLS_ROOT / "korea-area-and-parking" / "scripts" / "kr_area_parking_calculator.py"
EGRESS_SCRIPT = SKILLS_ROOT / "korea-area-and-parking" / "scripts" / "kr_egress_calculator.py"
COST_SCRIPT = SKILLS_ROOT / "korea-cost-and-feasibility" / "scripts" / "kr_cost_feasibility_calculator.py"
FACADE_SCRIPT = SKILLS_ROOT / "korea-facade-and-envelope" / "scripts" / "kr_facade_envelope_calculator.py"
UVAL_SCRIPT = SKILLS_ROOT / "architect-calculator" / "scripts" / "uvalue_calculator.py"
ENERGY_SCRIPT = SKILLS_ROOT / "architect-calculator" / "scripts" / "energy_calculator.py"
ANALYSIS_SCRIPT = WEB_DIR / "analysis-engine.js"
ANALYSIS_MAX_BYTES = 65536
WORKSPACE_CONTACT_URL = "https://wan2-website.web.app/#contact"


def finite_json_number(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


def finite_json_integer(value):
    number = int(value)
    if abs(number) > 10 ** 308:
        raise ValueError("Non-finite JSON integer")
    return number


def run_analysis_engine(payload=None, mode=None):
    """Use the browser's calculation functions; never build a shell command."""
    node_binary = os.environ.get("NODE_BINARY") or shutil.which("node")
    if not node_binary:
        return {"error": {"code": "ENGINE_UNAVAILABLE", "message": "Node.js calculation runtime is unavailable."}}, 503
    cmd = [node_binary, str(ANALYSIS_SCRIPT)]
    if mode in ("--capabilities", "--openapi"):
        cmd.append(mode)
    try:
        proc = subprocess.run(cmd, input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=12,
                              cwd=str(WEB_DIR), shell=False)
    except subprocess.TimeoutExpired:
        return {"error": {"code": "ENGINE_TIMEOUT", "message": "Analysis exceeded the calculation time limit."}}, 504
    except OSError:
        return {"error": {"code": "ENGINE_UNAVAILABLE", "message": "Node.js calculation runtime could not be started."}}, 503
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": {"code": "ENGINE_ERROR", "message": "Analysis returned an invalid response."}}, 500
    if proc.returncode:
        return result, 400 if proc.returncode == 2 else 500
    return result, 200


def run_json_script(script_path: Path, args: list[str]) -> dict:
    cmd = [sys.executable, str(script_path)] + args + ["--json"]
    env = os.environ.copy()
    env.setdefault("LAW_OC", "wanhee")
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", env=env, timeout=20, shell=False)
    except (subprocess.TimeoutExpired, OSError):
        return {"error": "보조 계산 실행 시간이 초과되었거나 실행 환경을 사용할 수 없습니다."}
    if proc.returncode != 0:
        return {"error": proc.stderr.strip() or proc.stdout.strip(), "returncode": proc.returncode}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"raw_output": proc.stdout}


class Seoul3DRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_request(self, code="-", size="-"):
        # Do not retain address-search query strings, parcel IDs or project data.
        print(f"HTTP {self.command} {code}", flush=True)

    def log_message(self, format, *args):
        pass

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        for name, value in pilot_security.response_headers(self.path):
            self.send_header(name, value)
        super().end_headers()

    def allow_request(self, method):
        path = urllib.parse.urlparse(self.path).path
        # One canonical public path. Never let percent decoding in the static
        # handler select a different resource after the authentication check.
        if "%" in path or "\\" in path or ":" in path:
            self.send_error(404)
            return False
        if path == "/dashboard.html" and method in {"GET", "HEAD"} and os.environ.get("WORKSPACE_ENTRY") == "contact":
            # The public model and enquiry flow never serve the private
            # workbench. Keep old model links usable without a Basic prompt.
            parsed = urllib.parse.urlparse(self.path)
            model_view = urllib.parse.parse_qs(parsed.query).get("view") == ["model"]
            target = "/model.html" + ("?" + parsed.query if parsed.query else "") if model_view else WORKSPACE_CONTACT_URL
            self.send_response(303)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        if pilot_security.protected_route(path, method) and not pilot_security.authorized(self.headers):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="FORMEQUA Pilot", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        if path.startswith("/api/") and not pilot_security.origin_allowed(self.headers, self.server.server_address[1]):
            self.send_json({"error": {"code": "SAME_ORIGIN_REQUIRED", "message": "같은 사이트에서 요청해 주세요."}}, 403)
            return False
        if path.startswith("/api/"):
            category = "studies-write" if method == "POST" and path in ("/api/v1/studies", "/api/v1/study-reviews") else ("calculate" if method == "POST" else "read")
            limit = {"studies-write": 6, "calculate": 20, "read": 240}[category]
            if not pilot_security.permit_rate(pilot_security.rate_client(self.client_address[0], self.headers), category, limit):
                self.send_json({"error": {"code": "RATE_LIMITED", "message": "요청이 많습니다. 잠시 후 다시 시도해 주세요."}}, 429)
                return False
        return True

    def read_calculation_body(self, max_bytes=ANALYSIS_MAX_BYTES):
        """Both calculation routes use the same bounded finite JSON contract."""
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            self.send_json({"error": {"code": "INVALID_REQUEST", "message": "Transfer-Encoding is unsupported; use Content-Length."}}, 400)
            return None
        if self.headers.get_content_type() != "application/json":
            self.close_connection = True
            self.send_json({"error": {"code": "UNSUPPORTED_MEDIA_TYPE", "message": "Content-Type must be application/json."}}, 415)
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > max_bytes:
            self.close_connection = True
            self.send_json({"error": {"code": "REQUEST_TOO_LARGE" if length > max_bytes else "INVALID_REQUEST",
                                      "message": f"A JSON body of 1–{max_bytes:,} bytes is required."}}, 413 if length > max_bytes else 400)
            return None
        try:
            self.connection.settimeout(10)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Incomplete body")
            value = json.loads(raw.decode("utf-8"), parse_float=finite_json_number, parse_int=finite_json_integer,
                               parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))
            if not isinstance(value, dict):
                raise ValueError("A JSON object is required")
        except (ValueError, UnicodeDecodeError, TimeoutError, RecursionError, OverflowError):
            self.close_connection = True
            self.send_json({"error": {"code": "INVALID_REQUEST", "message": "Body must be a finite UTF-8 JSON object."}}, 400)
            return None
        return value

    def do_OPTIONS(self):
        if self.allow_request("OPTIONS"):
            self.send_response(204)
            self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_HEAD(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.allow_request("HEAD"):
            return
        if path == "/model.html":
            self.send_public_model(head=True)
            return
        if not pilot_security.static_allowed(path):
            self.send_error(404)
            return
        super().do_HEAD()

    def do_GET(self):
        if not self.allow_request("GET"):
            return
        if self.path.startswith("/api/") and not pilot_security.API_SLOTS.acquire(blocking=False):
            self.send_json({"error": {"code": "BUSY", "message": "분석 중입니다. 잠시 후 다시 시도해 주세요."}}, 503)
            return
        try:
            self.get_route()
        finally:
            if self.path.startswith("/api/"):
                pilot_security.API_SLOTS.release()

    def get_route(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/model.html":
            self.send_public_model()
            return
        if parsed.path == "/api/v1/studies/provider-status":
            self.send_json({"error": {"code": "AUTOMATIC_GENERATION_REMOVED", "message": "자동 이미지 생성은 종료되었습니다."}}, 410)
            return
        if re.fullmatch(r"/api/v1/studies/[0-9a-f]{24}/status", parsed.path):
            self.send_json({"error": {"code": "AUTOMATIC_GENERATION_REMOVED", "message": "자동 이미지 생성은 종료되었습니다."}}, 410)
            return
        if parsed.path == "/api/v1/study-reviews" or parsed.path.startswith("/api/v1/study-reviews/"):
            # Full records contain addresses and financial assumptions. Read/export
            # is deliberately available only through owner filesystem tools.
            self.send_json({"error": {"code": "NOT_FOUND", "message": "찾을 수 없습니다."}}, 404)
            return
        if parsed.path == "/api/v1/studies" or re.fullmatch(r"/api/v1/studies/[0-9a-f]{24}/image\.png", parsed.path):
            try:
                if parsed.path == "/api/v1/studies":
                    query = urllib.parse.parse_qs(parsed.query)
                    self.send_json(study_archive.list_studies(query.get("limit", [60])[0], query.get("offset", [0])[0]))
                else:
                    png = study_archive.get_image(parsed.path.split("/")[4])
                    if png is None:
                        self.send_json({"error": {"code": "NOT_FOUND", "message": "연구 이미지를 찾을 수 없습니다."}}, 404)
                        return
                    self.send_response(200)
                    self.send_header("Content-Type", "image/png")
                    self.send_header("Content-Length", str(len(png)))
                    self.end_headers()
                    self.wfile.write(png)
            except study_catalog.CatalogError as exc:
                self.send_json({"error": {"code": exc.code, "message": str(exc)}}, exc.status)
            return
        if parsed.path.startswith("/api/v1/parcels/"):
            try:
                if parsed.path == "/api/v1/parcels/status":
                    payload = parcel_service.status()
                elif parsed.path == "/api/v1/parcels/search":
                    query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
                    payload = parcel_service.search_addresses(query)
                elif parsed.path == "/api/v1/parcels/context":
                    query = urllib.parse.parse_qs(parsed.query)
                    pnus = query.get("pnus", [""])[0].split(",")
                    payload = parcel_service.fetch_parcel_context(pnus, query.get("radiusM", ["120"])[0])
                elif parsed.path.endswith("/regulations"):
                    pnu = parsed.path.removeprefix("/api/v1/parcels/").removesuffix("/regulations")
                    payload = parcel_service.fetch_parcel_regulations(pnu)
                else:
                    payload = parcel_service.fetch_parcel(parsed.path.removeprefix("/api/v1/parcels/"))
                self.send_json(payload)
            except parcel_service.ParcelServiceError as exc:
                self.send_json({"error": {"code": exc.code, "message": exc.message}}, exc.status)
            return
        if parsed.path in ("/api/v1/capabilities", "/api/v1/openapi.json"):
            mode = "--capabilities" if parsed.path.endswith("capabilities") else "--openapi"
            payload, status = run_analysis_engine(mode=mode)
            self.send_json(payload, status)
            return
        if parsed.path == "/api/v1/analysis":
            self.send_json({"error": {"code": "METHOD_NOT_ALLOWED", "message": "Use POST with an application/json body."}}, 405)
            return
        if parsed.path == "/api/zoning-law-sync":
            qs = urllib.parse.parse_qs(parsed.query)
            oc = qs.get("oc", [os.environ.get("LAW_OC", "wanhee")])[0]
            cmd = [sys.executable, str(AREA_SCRIPT), "--dump-live-ordinance", "--oc", oc]
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=20)
            if proc.returncode == 0:
                try:
                    self.send_json(json.loads(proc.stdout))
                    return
                except json.JSONDecodeError:
                    pass
            self.send_json({"error": proc.stderr.strip() or proc.stdout.strip()}, status=500)
            return

        if parsed.path == "/api/law-lookup":
            qs = urllib.parse.parse_qs(parsed.query)
            raw_target = qs.get("target", ["ordin"])[0]
            target = "ordin" if raw_target in ("ordin", "ordinance") else raw_target
            query = qs.get("query", ["서울특별시 도시계획 조례"])[0]
            article = qs.get("article", [""])[0].strip()
            keyword = qs.get("keyword", [""])[0].strip()
            oc = qs.get("oc", [os.environ.get("LAW_OC", "wanhee")])[0]

            cli_args = ["--target", target, "--query", query, "--oc", oc, "--display", "5"]
            if article:
                cli_args += ["--article", article]
            elif keyword:
                cli_args += ["--keyword", keyword]
            elif "주차장" in query:
                cli_args += ["--keyword", "설치기준"]
            data = run_json_script(LAW_SCRIPT, cli_args)
            self.send_json(data)
            return

        if parsed.path == "/api/facade-presets":
            data = run_json_script(FACADE_SCRIPT, ["--dump-presets"])
            self.send_json(data)
            return

        if parsed.path == "/api/health":
            self.send_json({
                "status": "ok",
                "calculators_ready": all(
                    p.exists() for p in (LAW_SCRIPT, AREA_SCRIPT, EGRESS_SCRIPT, COST_SCRIPT, FACADE_SCRIPT, UVAL_SCRIPT, ENERGY_SCRIPT)
                ),
            })
            return

        if parsed.path == "/robots.txt":
            body = ("User-agent: GPTBot\nUser-agent: ChatGPT-User\nUser-agent: OAI-SearchBot\nUser-agent: ClaudeBot\nUser-agent: CCBot\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nDisallow: /dashboard.html\nDisallow: /api/\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not pilot_security.static_allowed(parsed.path):
            self.send_error(404)
            return
        return super().do_GET()

    def send_public_model(self, head=False):
        # Share the maintained model markup, while the explicit marker keeps
        # the visitor in model mode and prevents private API initializers.
        template = (WEB_DIR / "dashboard.html").read_text(encoding="utf-8")
        template = re.sub(r"<title>[^<]*</title>", "<title>FORMEQUA | Model Study</title>", template, count=1)
        template = template.replace('상세 작업실 열기 <span aria-hidden="true">Esc</span>', '상세 검토 문의 <span aria-hidden="true">↗</span>')
        body = re.sub(r"<body\b", '<body data-public-model="true"', template, count=1).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_POST(self):
        if not self.allow_request("POST"):
            return
        if not pilot_security.API_SLOTS.acquire(blocking=False):
            self.send_json({"error": {"code": "BUSY", "message": "분석 중입니다. 잠시 후 다시 시도해 주세요."}}, 503)
            return
        try:
            self.post_route()
        finally:
            pilot_security.API_SLOTS.release()

    def post_route(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/v1/studies":
            self.close_connection = True
            self.send_json({"error": {"code": "AUTOMATIC_GENERATION_REMOVED", "message": "이미지는 운영자 검토 후 수동 등록합니다."}}, 410)
            return
        if parsed.path == "/api/v1/study-reviews":
            if study_archive.storage_backend() == "disabled":
                # Do not read, parse or retain a review body on a stateless
                # deployment. Close the connection because the body is unread.
                self.close_connection = True
                self.send_json({"error": {"code": "NOT_FOUND", "message": "찾을 수 없습니다."}}, 404)
                return
            params = self.read_calculation_body(study_archive.MAX_BODY_BYTES)
            if params is None:
                return
            try:
                result = study_archive.collect(params)
                self.send_json(result, 201 if result["created"] else 200)
            except study_catalog.CatalogError as exc:
                self.send_json({"error": {"code": exc.code, "message": str(exc)}}, exc.status)
            return
        if parsed.path == "/api/v1/analysis":
            params = self.read_calculation_body()
            if params is None:
                return
            payload, status = run_analysis_engine(params)
            self.send_json(payload, status)
            return
        if parsed.path == "/api/calculate-skills":
            params = self.read_calculation_body()
            if params is None:
                return
            ranges = {
                "site_area": (1, 20000), "road_setback": (0, 20000), "public_contribution_area": (0, 20000),
                "bcr_pct": (0, 100), "far_pct": (0, 1500), "ground_floors": (1, 35), "core_ratio": (0, .9),
                "max_travel_distance": (0, 500), "land_cost_krw_per_pyeong": (0, 10000000000),
                "rent_krw_per_contract_pyeong": (0, 100000000), "deposit_months": (0, 120),
                "vacancy_pct": (0, 100), "exit_cap_rate_pct": (.01, 100), "width_m": (1, 500),
                "depth_m": (1, 500), "floor_height_m": (2, 10), "wwr_pct": (0, 100),
                "bay_width_m": (.1, 20), "louver_depth_m": (0, 10), "average_u_value": (.001, 20),
            }
            strings = {"zone", "building_use", "quality", "facade_type"}
            for key, value in params.items():
                valid = key in ranges and type(value) in (int, float) and math.isfinite(value) and ranges[key][0] <= value <= ranges[key][1]
                if key == "ground_floors" and valid:
                    valid = int(value) == value
                if key in strings:
                    valid = isinstance(value, str) and 0 < len(value) <= 80
                if key == "seoul_downtown":
                    valid = isinstance(value, bool)
                if not valid:
                    self.send_json({"error": {"code": "INVALID_REQUEST", "message": "Invalid reference-calculator input: " + key}}, 400)
                    return

            site_area = str(params.get("site_area", 1000))
            road_setback = str(params.get("road_setback", 0))
            pub_contrib = str(params.get("public_contribution_area", 0))
            seoul_downtown = bool(params.get("seoul_downtown", False))
            zone = str(params.get("zone", "general_commercial"))
            building_use = str(params.get("building_use", "office"))
            bcr_pct = str(params.get("bcr_pct", 58))
            far_pct = str(params.get("far_pct", 780))
            ground_floors = str(params.get("ground_floors", 14))
            core_ratio = str(params.get("core_ratio", 0.22))

            area_args = [
                "--site-area", site_area,
                "--road-setback-area", road_setback,
                "--public-contribution-area", pub_contrib,
                "--zone", zone,
                "--region", "seoul",
                "--building-use", building_use,
                "--bcr-pct", bcr_pct,
                "--far-pct", far_pct,
                "--ground-floors", ground_floors,
                "--core-ratio", core_ratio,
            ]
            if seoul_downtown:
                area_args.append("--seoul-downtown")

            area_res = run_json_script(AREA_SCRIPT, area_args)
            if not isinstance(area_res, dict) or "error" in area_res or "raw_output" in area_res:
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 계산 실패: area_res. 입력과 계산 범위를 확인하세요."}}, 422)
                return

            k8 = area_res.get("korean_8_area_table", {})
            z_info = area_res.get("zoning_and_density", {})
            required_areas = ["1_buildable_site_area_m2", "3_typical_ground_floor_plate_m2", "4_far_countable_gfa_m2", "7b_other_common_basement_area_m2"]
            if (not all(type(k8.get(key)) in (int, float) and math.isfinite(k8[key]) and k8[key] >= 0 for key in required_areas)
                    or type(z_info.get("estimated_basement_floors")) not in (int, float)
                    or not math.isfinite(z_info["estimated_basement_floors"]) or z_info["estimated_basement_floors"] < 0):
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 면적 계산 결과가 불완전해 후속 계산을 중단했습니다."}}, 422)
                return
            typ_floor = str(k8["3_typical_ground_floor_plate_m2"])
            hab_area = str(round(float(typ_floor) * (1.0 - float(core_ratio)), 2))
            bsmt_floors = str(int(z_info["estimated_basement_floors"]))

            egress_use = {"office":"office", "officetel":"office", "hotel":"hotel", "apartment":"multi_housing"}.get(building_use, "general")
            egress_res = run_json_script(
                EGRESS_SCRIPT,
                [
                    "--floor-area", typ_floor,
                    "--habitable-area", hab_area,
                    "--use-type", egress_use,
                    "--ground-floors", ground_floors,
                    "--basement-floors", bsmt_floors,
                ] + (["--max-travel-distance", str(params["max_travel_distance"])] if "max_travel_distance" in params else []),
            )
            if not isinstance(egress_res, dict) or "error" in egress_res or "raw_output" in egress_res:
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 계산 실패: egress_res. 입력과 계산 범위를 확인하세요."}}, 422)
                return

            cost_res = run_json_script(
                COST_SCRIPT,
                [
                    "--site-area-m2", str(k8["1_buildable_site_area_m2"]),
                    "--above-gfa-m2", str(k8["4_far_countable_gfa_m2"]),
                    "--basement-gfa-m2", str(k8["7b_other_common_basement_area_m2"]),
                    "--basement-floors", bsmt_floors,
                    "--building-type", building_use if building_use in ("office", "apartment", "officetel", "hotel") else "neighborhood_living",
                    "--quality", str(params.get("quality", "standard")),
                    "--land-cost-krw-per-pyeong", str(params.get("land_cost_krw_per_pyeong", 85000000)),
                    "--rent-krw-per-contract-pyeong", str(params.get("rent_krw_per_contract_pyeong", 115000)),
                    "--deposit-months", str(params.get("deposit_months", 10)),
                    "--vacancy-pct", str(params.get("vacancy_pct", 5.0)),
                    "--exit-cap-rate-pct", str(params.get("exit_cap_rate_pct", 4.5)),
                ],
            )
            if not isinstance(cost_res, dict) or "error" in cost_res or "raw_output" in cost_res:
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 계산 실패: cost_res. 입력과 계산 범위를 확인하세요."}}, 422)
                return

            facade_res = run_json_script(
                FACADE_SCRIPT,
                [
                    "--facade-type", str(params.get("facade_type", "curtain_wall")),
                    "--width-m", str(params.get("width_m", 32.0)),
                    "--depth-m", str(params.get("depth_m", 24.0)),
                    "--ground-floors", ground_floors,
                    "--floor-height-m", str(params.get("floor_height_m", 4.0)),
                    "--wwr-pct", str(params.get("wwr_pct", 68.0)),
                    "--bay-width-m", str(params.get("bay_width_m", 2.4)),
                    "--louver-depth-m", str(params.get("louver_depth_m", 0.35)),
                    "--above-gfa-m2", str(k8["4_far_countable_gfa_m2"]),
                ],
            )
            if not isinstance(facade_res, dict) or "error" in facade_res or "raw_output" in facade_res:
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 계산 실패: facade_res. 입력과 계산 범위를 확인하세요."}}, 422)
                return

            energy_res = run_json_script(
                ENERGY_SCRIPT,
                [
                    "--floor-area", str(k8["4_far_countable_gfa_m2"]),
                    "--envelope-area", str(round(float(k8["4_far_countable_gfa_m2"]) * 0.62, 1)),
                    "--average-u-value", str(params.get("average_u_value", 0.22)),
                    "--kr-climate", "seoul",
                ],
            )
            if not isinstance(energy_res, dict) or "error" in energy_res or "raw_output" in energy_res:
                self.send_json({"error": {"code": "REFERENCE_CALCULATION_FAILED", "message": "보조 계산 실패: energy_res. 입력과 계산 범위를 확인하세요."}}, 422)
                return

            self.send_json({
                "status": "ok",
                "scope": "independent-reference-calculators",
                "isCurrentDashboardResult": False, "isPermitConfirmation": False,
                "limitations": ["보조 계산은 실제 필지 경계·층별 혼합용도·현재 매스·금융 원장과 별도로 실행됩니다.", "에너지는 도일법 냉난방 열수요 가정이며 ZEB 또는 법정 에너지 적합 판정이 아닙니다."],
                "area_parking": area_res,
                "egress_fire": egress_res,
                "cost_feasibility": cost_res,
                "facade_envelope": facade_res,
                "energy_seoul": energy_res,
            })
            return

        self.send_json({"error": "Not found"}, status=404)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    pilot_security.validate_public_config()
    with socketserver.ThreadingTCPServer((os.environ.get("BIND_HOST", "127.0.0.1"), PORT), Seoul3DRequestHandler) as httpd:
        print(f"=== Seoul 3D Architectural Massing & Feasibility Server ===")
        print(f"Serving at: http://localhost:{PORT}")
        print(f"Skills root: {SKILLS_ROOT}")
        print(f"Korean Law Open API (LAW_OC): {os.environ.get('LAW_OC', 'wanhee')}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
