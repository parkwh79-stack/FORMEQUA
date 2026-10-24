#!/usr/bin/env python3
"""Korean egress review questions for an unverified average-floor scenario.

This CLI does not receive the floor-by-floor use, escape-floor status, verified
habitable areas, actual paths, fire compartments or stair construction needed to
establish statutory requirements. It therefore returns no compliance verdict.
Reviewed condition references are separate from a source retrieval in this run.
"""
import argparse
import datetime
import json
import math
import sys

USE_TYPES = {
    "cultural_assembly": "문화·집회시설 세부용도 미확인",
    "religious": "종교시설 세부용도 미확인",
    "amusement": "위락시설 세부용도 미확인",
    "retail": "판매시설",
    "medical": "의료시설 세부용도 미확인",
    "elderly_child": "노유자시설 세부용도 미확인",
    "hotel": "숙박시설 세부용도 미확인",
    "academy_reading": "학원·독서실 등 세부용도 미확인",
    "multi_housing": "공동주택·기숙사·다중/다가구 구분 미확인",
    "office": "업무시설 (일반 사무소·오피스텔 구분 미확인)",
    "general": "기타 용도 미확인",
}

REVIEWED_CONDITIONS = [
    {"article": "건축법 시행령 제34조제2항", "url": "https://www.law.go.kr/법령/건축법시행령/제34조",
     "note": "피난층 외 해당 층의 세부용도·층수·검증된 해당용도/거실 면적을 구분해야 합니다. 일반 사무소의 제4호는 3층 이상·거실400㎡, 오피스텔과 층당4세대 이하 제외 공동주택의 제3호는 거실300㎡ 조건입니다. 평균층 면적으로 계단 개소수를 확정하지 않습니다."},
    {"article": "건축법 시행령 제35조제1~3항", "url": "https://www.law.go.kr/법령/건축법시행령/제35조",
     "note": "11층 이상(공동주택16층 이상)과 지하3층 이하의 특별피난계단 조건에는 해당 층400㎡ 미만 제외 등이 있습니다. 판매시설 제3항은 제1항의 적용을 전제로 합니다. 내화·불연, 방화구획, 갓복도식 여부와 실제 해당 층을 확인해야 합니다."},
    {"article": "건축법 시행령 제34조제1항", "url": "https://www.law.go.kr/법령/건축법시행령/제34조",
     "note": "실제 거실 각 부분부터 직통계단까지의 보행경로와 내화·불연, 층별 용도 및 단서의 적용을 확인해야 합니다. 입력 거리와 30·40·50m 등의 숫자 비교는 실제 보행 검증이 아닙니다."},
]


def calculate(args):
    today = datetime.date.today().isoformat()
    return {
        "assessment_status": "NEEDS_VERIFICATION",
        "assessment_scope": "UNVERIFIED_AVERAGE_FLOOR_REFERENCE",
        "is_permit_confirmation": False,
        "calculated_at": today,
        "inputs": {
            "floor_area_m2": round(args.floor_area, 2),
            "habitable_area_m2": round(args.habitable_area, 2) if args.habitable_area is not None else None,
            "habitable_area_verified": False,
            "use_type": args.use_type,
            "use_name_kr": USE_TYPES[args.use_type],
            "ground_floors": args.ground_floors,
            "basement_floors": args.basement_floors,
            "fireproof_structure": args.fireproof,
            "sprinklered": args.sprinklered,
            "planned_max_travel_distance_m": args.max_travel_distance,
            "travel_distance_source": "UNVERIFIED_INPUT_ASSUMPTION" if args.max_travel_distance is not None else "NOT_PROVIDED",
        },
        "egress_requirements": {
            "status": "NEEDS_VERIFICATION",
            "required_direct_stairs": None,
            "two_stair_trigger_habitable_m2": None,
            "required_stair_type": None,
            "stair_legal_basis": "층별 세부용도·피난층·면적 및 예외 확인 필요",
            "max_allowed_travel_distance_m": None,
            "travel_distance_status": "NEEDS_VERIFICATION",
            "min_stair_effective_width_mm": None,
            "min_corridor_width_double_loaded_mm": None,
            "min_corridor_width_single_loaded_mm": None,
        },
        "fire_compartmentation": {
            "status": "NEEDS_VERIFICATION",
            "vertical_floor_by_floor_required": None,
            "max_compartment_area_up_to_10f_m2": None,
            "max_compartment_area_11f_plus_std_m2": None,
            "max_compartment_area_11f_plus_noncombustible_m2": None,
            "estimated_compartments_per_floor_up_to_10f": None,
        },
        "reviewed_rule_conditions": REVIEWED_CONDITIONS,
        "review_questions": [
            "어느 층의 검토이며 그 층은 실제 피난층입니까?",
            "층별 법정 세부용도·해당용도 바닥면적·거실 면적과 측정 근거가 있습니까?",
            "공동주택의 해당 층 세대수와 갓복도식 여부, 일반 사무소와 오피스텔의 구분은 확인했습니까?",
            "계단 개소수·출입구 이격·방화문·부속실·제연·실제 경로와 폭을 도면에서 확인했습니까?",
            "층별 내화·불연 구조와 실제 방화구획·관통부·소방설비의 적용 조건을 확인했습니까?",
        ],
        "warnings": [
            "평균층 한 개와 사용자 소방 가정으로 법정 정원·계단 수·특별피난·폭·방화구획 적합을 확정하지 않습니다.",
            "미입력 거실 면적을 바닥면적의78% 등 전용률로 채우지 않습니다.",
            "입력 보행거리는 미측정 비교값입니다. 서버의 기본40m도 실제 경로 검증이나 적합 판정이 아닙니다.",
            "법령 원문을 이번 계산에서 조회하지 않았습니다. 규정 판본·신청일·관할 및 실제 층별 자료를 추가 확인해야 합니다.",
        ],
        "evidence_records": [{
            "source_name": "건축법 시행령 제34·35조 및 피난·방화구조 기준 규칙 — 적용 확인 필요",
            "issuing_authority": "국토교통부 / 법제처 국가법령정보센터",
            "reference_date": None,
            "retrieved_at": None,
            "calculated_at": today,
            "spatial_unit": "대한민국 전국 — 세부 적용 조건 미확인",
            "verification_status": "NEEDS_VERIFICATION",
            "source_retrieved_this_run": False,
        }],
    }


def format_output(res):
    inp = res["inputs"]
    area = inp["habitable_area_m2"]
    habitable = f"{area:,.2f}m2 (미검증 입력)" if area is not None else "미입력"
    lines = [
        "=== 한국 피난·방화 검토 질문 (평균층 보조 참조) ===",
        f"용도 입력: {inp['use_name_kr']}",
        f"바닥면적: {inp['floor_area_m2']:,.2f}m2 / 거실 면적: {habitable}",
        "법정 계단 개소수·유형·보행거리·폭·방화구획: 추가 확인 필요",
        "이번 실행에서 법령 조회·실제 경로 측정·법정 적합 판정을 수행하지 않았습니다.",
    ]
    lines.extend("- " + item for item in res["review_questions"])
    return "\n".join(lines)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="한국 피난·방화 평균층 보조 검토 질문 — 법정 적합 판정 미수행")
    parser.add_argument("--floor-area", type=float, required=True)
    parser.add_argument("--habitable-area", type=float, default=None)
    parser.add_argument("--use-type", choices=list(USE_TYPES), default="office")
    parser.add_argument("--ground-floors", type=int, default=5)
    parser.add_argument("--basement-floors", type=int, default=1)
    parser.add_argument("--fireproof", action="store_true")
    parser.add_argument("--sprinklered", action="store_true")
    parser.add_argument("--max-travel-distance", type=float, default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.floor_area) or args.floor_area <= 0:
        parser.error("floor-area must be a positive finite number")
    if args.habitable_area is not None and (not math.isfinite(args.habitable_area) or not 0 <= args.habitable_area <= args.floor_area):
        parser.error("habitable-area must be a finite number within floor-area")
    if args.ground_floors < 1 or args.basement_floors < 0:
        parser.error("ground-floors must be positive and basement-floors nonnegative")
    if args.max_travel_distance is not None and (not math.isfinite(args.max_travel_distance) or args.max_travel_distance < 0):
        parser.error("max-travel-distance must be a nonnegative finite number")
    result = calculate(args)
    print(json.dumps(result, indent=2, ensure_ascii=False) if args.json else format_output(result))


if __name__ == "__main__":
    main()
