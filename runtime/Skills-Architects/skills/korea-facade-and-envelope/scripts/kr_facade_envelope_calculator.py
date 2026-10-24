#!/usr/bin/env python3
"""
Korean Building Facade & Envelope Performance, Cost & Procedural Grammar Calculator
(kr_facade_envelope_calculator.py)

Synthesizes:
1. Abhinavbwj/Skills-Architects (building-envelope SKILL.md, wall-systems.md, glazing-systems.md)
2. ibuilder/massing & hypar-io/BuildingBlocks (Facade/Envelope area & WWR to cost/IFC coupling)
3. achrefelouafi/BuildingGeneratorThreeJS & codedgar/three-fenestra (3-tier procedural bay grammar)
4. 국토교통부고시 「건축물의 에너지절약설계기준」 별표1 (중부2지역: 서울·인천·경기 열관류율 기준)
5. 「건축법」 제52조 및 「건축물의 피난·방화구조 등의 기준에 관한 규칙」 제24조 (외벽 마감재료 불연·준불연 및 층간 방화 스팬드럴)
"""

import argparse
import json
import math
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

PYEONG_FACTOR = 3.305785

# 국토교통부 「건축물의 에너지절약설계기준」 별표1 (중부2지역: 서울·인천·경기, 외기 직접면, W/m2K)
SEOUL_THERMAL_LIMITS = {
    "exterior_wall_u_limit": 0.170,
    "roof_u_limit": 0.110,
    "floor_u_limit": 0.170,
    "window_non_residential_u_limit": 1.000,
    "window_residential_u_limit": 0.900,
    "regulation_source": "국토교통부고시 「건축물의 에너지절약설계기준」 [별표1] 중부2지역(서울)",
    "fire_code_source": "「건축법」 제52조(건축물의 마감재료 등) 및 「건축물의 피난·방화구조 등의 기준에 관한 규칙」 제24조",
}

FACADE_ARCHETYPES = {
    "curtain_wall": {
        "key": "curtain_wall",
        "name_kr": "하이엔드 유니타이즈드 커튼월 (Low-E 삼중유리)",
        "name_en": "Unitized Low-E Triple Glazed Curtain Wall",
        "best_for_kr": "강남·여의도 프라임 오피스 및 대기업 사옥",
        "default_wwr_pct": 72.0,
        "default_bay_width_m": 2.4,
        "default_louver_depth_m": 0.15,
        "wall_u_value": 0.155,
        "window_u_value": 0.840,
        "psi_bridge_surcharge": 0.035,
        "base_shgc": 0.240,
        "vlt_pct": 58.0,
        "acoustic_rw_db": 40,
        "fire_rating": "준불연/불연 (알루미늄 단열프레임 + 층간 내화 백패널·스팬드럴 0.8m)",
        "embodied_carbon_kgco2_m2": 118.0,
        "unit_cost_krw_per_wall_m2": 680000,
        "cost_delta_pct": 6.5,
        "rent_premium_pct": 4.5,
        "layer_buildup_kr": [
            "외측: 42mm 로이(Low-E) 아르곤 삼중유리 (6T+12A+6T+12A+6T)",
            "프레임: 열교차단 폴리아미드 알루미늄 유니타이즈드 멀리언 (150mm)",
            "스팬드럴: 불연 미네랄울 150mm + 알루미늄 백패널 + 층간 방화채움재",
        ],
    },
    "kinetic_louver": {
        "key": "kinetic_louver",
        "name_kr": "친환경 수직 차양 루버 + 더블스킨 커튼월",
        "name_en": "Parametric Vertical Sun-Shading Fin & Curtain Wall",
        "best_for_kr": "종로·광화문·판교 친환경 사옥 및 제로에너지(ZEB) 인증 빌딩",
        "default_wwr_pct": 65.0,
        "default_bay_width_m": 2.0,
        "default_louver_depth_m": 0.55,
        "wall_u_value": 0.145,
        "window_u_value": 0.810,
        "psi_bridge_surcharge": 0.030,
        "base_shgc": 0.230,
        "vlt_pct": 54.0,
        "acoustic_rw_db": 43,
        "fire_rating": "불연 (아노다이징 알루미늄 루버 핀 + 불연 미네랄울 스팬드럴)",
        "embodied_carbon_kgco2_m2": 128.0,
        "unit_cost_krw_per_wall_m2": 790000,
        "cost_delta_pct": 9.5,
        "rent_premium_pct": 5.5,
        "layer_buildup_kr": [
            "외측 차양: 돌출형 아노다이징 알루미늄 수직 루버 핀 (일사차폐율 +35%)",
            "창호층: 42mm 더블 로이(Double Low-E) 삼중유리",
            "단열층: 열교차단 브래킷(Thermal Break) + 불연 미네랄울 160mm",
        ],
    },
    "brick_rainscreen": {
        "key": "brick_rainscreen",
        "name_kr": "성수동 테라코타·적벽돌 레인스크린 & 펀치드 윈도우",
        "name_en": "Terracotta/Brick Ventilated Rainscreen & Deep Punched Windows",
        "best_for_kr": "성수동 지식산업센터, 신사·한남 크리에이티브 오피스, 브랜드 사옥",
        "default_wwr_pct": 45.0,
        "default_bay_width_m": 3.2,
        "default_louver_depth_m": 0.25,
        "wall_u_value": 0.138,
        "window_u_value": 0.890,
        "psi_bridge_surcharge": 0.020,
        "base_shgc": 0.310,
        "vlt_pct": 60.0,
        "acoustic_rw_db": 53,
        "fire_rating": "불연 REI 120 (점토벽돌/테라코타 패널 + 통기층 50mm + 준불연 PF보드/미네랄울)",
        "embodied_carbon_kgco2_m2": 82.0,
        "unit_cost_krw_per_wall_m2": 490000,
        "cost_delta_pct": 0.0,
        "rent_premium_pct": 2.0,
        "layer_buildup_kr": [
            "외장재: 100mm 고밀도 점토 적벽돌 / 테라코타 오픈조인트 패널",
            "중공층: 50mm 통기형 레인스크린 캐비티 + 스테인리스 열교차단 앵커",
            "단열/구조: 준불연 PF보드 130mm (또는 미네랄울 160mm) + 철근콘크리트 외벽 200mm",
        ],
    },
    "stone_ribbon": {
        "key": "stone_ribbon",
        "name_kr": "라임스톤·포천석 PC 패널 & 수평 리본창",
        "name_en": "Limestone/Granite Precast Panel & Continuous Ribbon Windows",
        "best_for_kr": "도심 중견기업 사옥, 메디컬 빌딩, 명동·중구 상업시설",
        "default_wwr_pct": 54.0,
        "default_bay_width_m": 3.0,
        "default_louver_depth_m": 0.20,
        "wall_u_value": 0.148,
        "window_u_value": 0.880,
        "psi_bridge_surcharge": 0.025,
        "base_shgc": 0.280,
        "vlt_pct": 56.0,
        "acoustic_rw_db": 51,
        "fire_rating": "불연 REI 120 (천연석재 30T 트러스 건식트랙 + 불연 단열재)",
        "embodied_carbon_kgco2_m2": 96.0,
        "unit_cost_krw_per_wall_m2": 560000,
        "cost_delta_pct": 3.0,
        "rent_premium_pct": 3.0,
        "layer_buildup_kr": [
            "외장재: 30mm 유럽산 라임스톤 / 포천석 건식 트러스 패널",
            "창호층: 수평 연속형 알루미늄 리본창 (로이 복층/삼중유리)",
            "단열/구조: 외단열 미네랄울 150mm + RC 슬래브 엣지 열교차단재",
        ],
    },
    "diagrid_biophilic": {
        "key": "diagrid_biophilic",
        "name_kr": "미래형 다이아그리드 외골격 & 바이오필릭 그린 테라스",
        "name_en": "Futuristic Diagrid Exoskeleton & Biophilic Sky Terraces",
        "best_for_kr": "여의도·용산·강남 하이엔드 랜드마크 복합시설 및 미래형 헤드쿼터",
        "default_wwr_pct": 68.0,
        "default_bay_width_m": 3.6,
        "default_louver_depth_m": 0.70,
        "wall_u_value": 0.140,
        "window_u_value": 0.780,
        "psi_bridge_surcharge": 0.028,
        "base_shgc": 0.200,
        "vlt_pct": 62.0,
        "acoustic_rw_db": 46,
        "fire_rating": "불연 내화피복 다이아그리드 강재 + 삼중 접합 방화유리 + 캔틸레버 방화 테라스",
        "embodied_carbon_kgco2_m2": 112.0,
        "unit_cost_krw_per_wall_m2": 880000,
        "cost_delta_pct": 13.0,
        "rent_premium_pct": 8.0,
        "layer_buildup_kr": [
            "외골격: 티타늄 화이트 알루미늄 클래딩 다이아그리드(Diagrid) 구조 프레임",
            "바이오필릭 테라스: 돌출 스카이 발코니(열교차단 Isokorb 커넥터) + 자동관수 식재 플랜터",
            "창호층: 초고투명 저철분 트리플 로이(Triple Low-E) 커튼월 (U=0.78 W/㎡K)",
        ],
    },
}


def evaluate_facade_envelope(
    facade_type: str = "curtain_wall",
    width_m: float = 36.0,
    depth_m: float = 24.0,
    ground_floors: int = 14,
    floor_height_m: float = 4.0,
    wwr_pct: float | None = None,
    bay_width_m: float | None = None,
    louver_depth_m: float | None = None,
    above_gfa_m2: float = 10000.0,
    is_residential: bool = False,
) -> dict:
    arch = FACADE_ARCHETYPES.get(facade_type, FACADE_ARCHETYPES["curtain_wall"])

    actual_wwr_pct = max(20.0, min(88.0, float(wwr_pct if wwr_pct is not None else arch["default_wwr_pct"])))
    actual_bay_m = max(1.2, min(6.0, float(bay_width_m if bay_width_m is not None else arch["default_bay_width_m"])))
    actual_louver_m = max(0.0, min(1.5, float(louver_depth_m if louver_depth_m is not None else arch["default_louver_depth_m"])))

    wwr_ratio = actual_wwr_pct / 100.0
    perimeter_m = 2.0 * (width_m + depth_m)
    building_height_m = ground_floors * floor_height_m
    gross_wall_area_m2 = perimeter_m * building_height_m

    # 3-Tier Breakdown (Podium 1-2F, Typical Shaft, Crown Parapet)
    podium_floors = min(2, ground_floors)
    podium_area_m2 = perimeter_m * (podium_floors * floor_height_m)
    shaft_area_m2 = max(0.0, gross_wall_area_m2 - podium_area_m2)
    parapet_area_m2 = perimeter_m * 1.35

    vision_glass_area_m2 = gross_wall_area_m2 * wwr_ratio
    opaque_spandrel_area_m2 = gross_wall_area_m2 * (1.0 - wwr_ratio) + parapet_area_m2

    bays_per_floor = max(4, int(round(perimeter_m / actual_bay_m)))
    total_bay_units = bays_per_floor * ground_floors
    louver_fin_area_m2 = total_bay_units * floor_height_m * actual_louver_m * (
        1.4 if facade_type in ("kinetic_louver", "diagrid_biophilic") else 0.35
    )

    # Thermal Performance (U-value & SHGC with louver shading correction)
    wall_u = arch["wall_u_value"]
    win_u = arch["window_u_value"]
    psi_surcharge = arch["psi_bridge_surcharge"]
    effective_facade_u = (1.0 - wwr_ratio) * wall_u + wwr_ratio * win_u + psi_surcharge

    shading_factor = max(0.52, 1.0 - (actual_louver_m * 0.42))
    effective_shgc = round(arch["base_shgc"] * shading_factor, 3)

    win_u_limit = (
        SEOUL_THERMAL_LIMITS["window_residential_u_limit"]
        if is_residential
        else SEOUL_THERMAL_LIMITS["window_non_residential_u_limit"]
    )
    wall_u_compliant = wall_u <= SEOUL_THERMAL_LIMITS["exterior_wall_u_limit"]
    win_u_compliant = win_u <= win_u_limit

    # Annual Envelope Heating + Cooling Energy Impact (Seoul HDD ~2650, CDD ~980)
    heating_loss_kwh_m2 = (effective_facade_u * gross_wall_area_m2 * 2650 * 24 / 1000.0) / max(1.0, above_gfa_m2)
    cooling_solar_kwh_m2 = (vision_glass_area_m2 * effective_shgc * 340.0) / max(1.0, above_gfa_m2)
    envelope_eui_kwh_m2_yr = round(heating_loss_kwh_m2 + cooling_solar_kwh_m2, 1)

    # Cost Calculation (Base archetype unit cost adjusted by WWR & louver depth)
    wwr_cost_multiplier = 1.0 + ((actual_wwr_pct - arch["default_wwr_pct"]) * 0.0025)
    louver_cost_Dynamic = louver_fin_area_m2 * 185000  # KRW per m2 of fin surface
    total_facade_cost_krw = round(
        (gross_wall_area_m2 + parapet_area_m2) * arch["unit_cost_krw_per_wall_m2"] * wwr_cost_multiplier
        + louver_cost_Dynamic
    )
    above_gfa_pyeong = max(1.0, above_gfa_m2 / PYEONG_FACTOR)
    facade_cost_per_gfa_pyeong_man = round((total_facade_cost_krw / above_gfa_pyeong) / 10000.0, 1)

    # Embodied Carbon
    total_embodied_carbon_ton = round(
        ((gross_wall_area_m2 + parapet_area_m2) * arch["embodied_carbon_kgco2_m2"]) / 1000.0, 1
    )

    return {
        "skill": "korea-facade-and-envelope",
        "archetype": {
            "key": arch["key"],
            "name_kr": arch["name_kr"],
            "name_en": arch["name_en"],
            "best_for_kr": arch["best_for_kr"],
            "layer_buildup_kr": arch["layer_buildup_kr"],
        },
        "geometry_3_tier_grammar": {
            "perimeter_m": round(perimeter_m, 2),
            "building_height_m": round(building_height_m, 2),
            "gross_wall_area_m2": round(gross_wall_area_m2, 1),
            "tier1_podium_area_m2": round(podium_area_m2, 1),
            "tier2_typical_shaft_area_m2": round(shaft_area_m2, 1),
            "tier3_crown_parapet_area_m2": round(parapet_area_m2, 1),
            "vision_glass_area_m2": round(vision_glass_area_m2, 1),
            "opaque_spandrel_area_m2": round(opaque_spandrel_area_m2, 1),
            "louver_fin_surface_area_m2": round(louver_fin_area_m2, 1),
            "wwr_pct": round(actual_wwr_pct, 1),
            "bay_width_m": round(actual_bay_m, 2),
            "louver_depth_m": round(actual_louver_m, 2),
            "bays_per_floor": bays_per_floor,
            "total_bay_modules": total_bay_units,
        },
        "korean_code_compliance": {
            "region": "중부2지역 (서울특별시)",
            "wall_u_value_w_m2k": wall_u,
            "wall_u_limit_w_m2k": SEOUL_THERMAL_LIMITS["exterior_wall_u_limit"],
            "wall_u_status": "COMPLIANT" if wall_u_compliant else "NON_COMPLIANT",
            "window_u_value_w_m2k": win_u,
            "window_u_limit_w_m2k": win_u_limit,
            "window_u_status": "COMPLIANT" if win_u_compliant else "NON_COMPLIANT",
            "effective_facade_u_w_m2k": round(effective_facade_u, 3),
            "effective_shgc": effective_shgc,
            "vlt_pct": arch["vlt_pct"],
            "acoustic_rw_db": arch["acoustic_rw_db"],
            "fire_safety_grade": arch["fire_rating"],
            "regulation_source": SEOUL_THERMAL_LIMITS["regulation_source"],
            "fire_code_source": SEOUL_THERMAL_LIMITS["fire_code_source"],
        },
        "energy_and_cost_impact": {
            "envelope_eui_kwh_m2_yr": envelope_eui_kwh_m2_yr,
            "total_facade_cost_krw": total_facade_cost_krw,
            "total_facade_cost_eok": round(total_facade_cost_krw / 1e8, 2),
            "facade_cost_per_gfa_pyeong_man": facade_cost_per_gfa_pyeong_man,
            "const_cost_delta_pct": arch["cost_delta_pct"],
            "rent_premium_pct": arch["rent_premium_pct"],
            "embodied_carbon_tco2e": total_embodied_carbon_ton,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Korean Facade & Envelope Calculator")
    parser.add_argument("--facade-type", default="curtain_wall", choices=list(FACADE_ARCHETYPES.keys()))
    parser.add_argument("--width-m", type=float, default=36.0)
    parser.add_argument("--depth-m", type=float, default=24.0)
    parser.add_argument("--ground-floors", type=int, default=14)
    parser.add_argument("--floor-height-m", type=float, default=4.0)
    parser.add_argument("--wwr-pct", type=float, default=None)
    parser.add_argument("--bay-width-m", type=float, default=None)
    parser.add_argument("--louver-depth-m", type=float, default=None)
    parser.add_argument("--above-gfa-m2", type=float, default=10000.0)
    parser.add_argument("--residential", action="store_true")
    parser.add_argument("--dump-presets", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.dump_presets:
        print(json.dumps({"status": "ok", "archetypes": FACADE_ARCHETYPES, "seoul_limits": SEOUL_THERMAL_LIMITS}, ensure_ascii=False, indent=2))
        return

    res = evaluate_facade_envelope(
        facade_type=args.facade_type,
        width_m=args.width_m,
        depth_m=args.depth_m,
        ground_floors=args.ground_floors,
        floor_height_m=args.floor_height_m,
        wwr_pct=args.wwr_pct,
        bay_width_m=args.bay_width_m,
        louver_depth_m=args.louver_depth_m,
        above_gfa_m2=args.above_gfa_m2,
        is_residential=args.residential,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
