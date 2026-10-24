#!/usr/bin/env python3
"""
Korean Construction Cost & Real Estate Development Feasibility Calculator
(kr_cost_feasibility_calculator.py)
Separates above-ground GFA, underground GFA, and deep excavation / earth-retention
(흙막이 가시설) construction costs in KRW (원/m2, 만원/평, 억원), applies KICT
Construction Cost Index adjustment, models full Korean Total Development Cost
(토지비, 취득세, 직접공사비, 설계·감리·인입·부담금, PF 금융비용, 예비비), and evaluates
stabilized rental NOI, Yield on Cost, and Exit Cap Rate valuation.
"""

import argparse
import datetime
import json
import sys


PYEONG_FACTOR = 3.305785
EOK = 100_000_000.0  # 1 억원 = 100,000,000 KRW
MAN = 10_000.0       # 1 만원 = 10,000 KRW

# Base construction cost in KRW per pyeong (3.3058 m2), 2025/2026 baseline
KR_BASE_COST_PER_PYEONG = {
    "office": {
        "name_kr": "업무시설(오피스)",
        "above": {"basic": 6_800_000, "standard": 8_000_000, "premium": 9_800_000},
        "below": {"basic": 4_800_000, "standard": 5_500_000, "premium": 6_400_000},
    },
    "neighborhood_living": {
        "name_kr": "근린생활시설(꼬마빌딩/상가)",
        "above": {"basic": 6_200_000, "standard": 7_300_000, "premium": 8_800_000},
        "below": {"basic": 4_600_000, "standard": 5_200_000, "premium": 6_000_000},
    },
    "apartment": {
        "name_kr": "공동주택(아파트/다세대)",
        "above": {"basic": 7_000_000, "standard": 8_200_000, "premium": 10_500_000},
        "below": {"basic": 4_800_000, "standard": 5_400_000, "premium": 6_200_000},
    },
    "officetel": {
        "name_kr": "업무시설(오피스텔)",
        "above": {"basic": 6_600_000, "standard": 7_600_000, "premium": 9_000_000},
        "below": {"basic": 4_700_000, "standard": 5_300_000, "premium": 6_000_000},
    },
    "hotel": {
        "name_kr": "숙박시설(호텔)",
        "above": {"basic": 8_200_000, "standard": 9_800_000, "premium": 13_200_000},
        "below": {"basic": 5_200_000, "standard": 6_000_000, "premium": 7_000_000},
    },
    "logistics": {
        "name_kr": "창고시설(물류센터)",
        "above": {"basic": 4_600_000, "standard": 5_600_000, "premium": 7_500_000},
        "below": {"basic": 4_000_000, "standard": 4_800_000, "premium": 5_600_000},
    },
}


def get_basement_depth_multiplier(basement_floors: int) -> float:
    """Earth-retention (CIP/Slurry Wall) & deep excavation cost multiplier by basement depth."""
    if basement_floors <= 0:
        return 0.0
    if basement_floors <= 2:
        return 1.00
    if basement_floors <= 4:
        return 1.22
    if basement_floors <= 6:
        return 1.45
    return 1.65


def calculate(args):
    today = datetime.date.today().isoformat()
    site_pyeong = args.site_area_m2 / PYEONG_FACTOR
    above_pyeong = args.above_gfa_m2 / PYEONG_FACTOR
    below_pyeong = args.basement_gfa_m2 / PYEONG_FACTOR
    total_gfa_m2 = args.above_gfa_m2 + args.basement_gfa_m2
    total_gfa_pyeong = total_gfa_m2 / PYEONG_FACTOR

    b_info = KR_BASE_COST_PER_PYEONG[args.building_type]
    kict_Escalation = args.kict_index_current / args.kict_index_base

    above_unit_krw_py = (
        args.override_above_cost_pyeong
        if args.override_above_cost_pyeong is not None
        else b_info["above"][args.quality] * kict_Escalation
    )
    below_base_krw_py = (
        args.override_below_cost_pyeong
        if args.override_below_cost_pyeong is not None
        else b_info["below"][args.quality] * kict_Escalation
    )
    depth_mult = get_basement_depth_multiplier(args.basement_floors)
    below_effective_krw_py = below_base_krw_py * depth_mult

    # 1. Direct Construction Cost (직접공사비)
    above_construction_krw = above_pyeong * above_unit_krw_py
    below_construction_krw = below_pyeong * below_effective_krw_py
    demolition_krw = site_pyeong * args.demolition_cost_per_site_pyeong
    direct_construction_krw = above_construction_krw + below_construction_krw + demolition_krw
    blended_cost_per_pyeong = direct_construction_krw / total_gfa_pyeong if total_gfa_pyeong > 0 else 0.0
    blended_cost_per_m2 = direct_construction_krw / total_gfa_m2 if total_gfa_m2 > 0 else 0.0

    # 2. Land Cost (토지비 및 부대비용)
    land_purchase_krw = site_pyeong * args.land_cost_krw_per_pyeong
    land_acq_tax_krw = land_purchase_krw * (args.land_acq_tax_pct / 100.0)
    land_brokerage_legal_krw = land_purchase_krw * 0.009
    total_land_cost_krw = land_purchase_krw + land_acq_tax_krw + land_brokerage_legal_krw

    # 3. Soft Costs & Statutory Charges (설계·감리·인입·부담금·보존등기세)
    design_supervision_krw = direct_construction_krw * (args.design_supervision_pct / 100.0)
    utility_impact_fees_krw = direct_construction_krw * (args.utility_impact_fee_pct / 100.0)
    preservation_registration_tax_krw = direct_construction_krw * 0.0316  # 원시취득세 3.16%
    total_soft_cost_krw = design_supervision_krw + utility_impact_fees_krw + preservation_registration_tax_krw

    # 4. Contingency & PF Financing Cost (예비비 및 금융비용)
    contingency_krw = (direct_construction_krw + total_soft_cost_krw) * (args.contingency_pct / 100.0)
    # Typical PF financing: 100% of land + 50% avg drawn construction over construction period
    pf_interest_base_krw = total_land_cost_krw * 0.70 + direct_construction_krw * 0.45
    pf_financing_krw = pf_interest_base_krw * (args.pf_interest_rate_pct / 100.0) * (args.construction_months / 12.0)

    total_development_cost_krw = (
        total_land_cost_krw
        + direct_construction_krw
        + total_soft_cost_krw
        + contingency_krw
        + pf_financing_krw
    )

    # 5. Rental Operation & Cap Rate Valuation (임대수지 및 자본환원 가치)
    leasable_contract_pyeong = above_pyeong * args.leasable_ratio_to_above_gfa
    monthly_rent_total_krw = leasable_contract_pyeong * args.rent_krw_per_contract_pyeong
    total_deposit_krw = monthly_rent_total_krw * args.deposit_months
    annual_rent_krw = monthly_rent_total_krw * 12.0
    annual_deposit_interest_krw = total_deposit_krw * (args.deposit_yield_pct / 100.0)
    gross_potential_income_krw = annual_rent_krw + annual_deposit_interest_krw
    effective_gross_income_krw = gross_potential_income_krw * (1.0 - args.vacancy_pct / 100.0)

    # Net OPEX (재산세·종부세·보험·수선유지·PM 수수료, 관리비 실비정산 외 임대인 부담분)
    annual_landlord_opex_krw = effective_gross_income_krw * (args.landlord_opex_ratio_pct / 100.0)
    noi_krw = effective_gross_income_krw - annual_landlord_opex_krw

    stabilized_asset_value_krw = noi_krw / (args.exit_cap_rate_pct / 100.0) if args.exit_cap_rate_pct > 0 else 0.0
    yield_on_cost_pct = (noi_krw / total_development_cost_krw) * 100.0 if total_development_cost_krw > 0 else 0.0
    yield_spread_bps = (yield_on_cost_pct - args.exit_cap_rate_pct) * 100.0
    development_profit_krw = stabilized_asset_value_krw - total_development_cost_krw
    development_margin_pct = (development_profit_krw / total_development_cost_krw) * 100.0 if total_development_cost_krw > 0 else 0.0

    return {
        "areas": {
            "site_area_m2": round(args.site_area_m2, 2),
            "site_area_pyeong": round(site_pyeong, 2),
            "above_gfa_m2": round(args.above_gfa_m2, 2),
            "above_gfa_pyeong": round(above_pyeong, 2),
            "basement_gfa_m2": round(args.basement_gfa_m2, 2),
            "basement_gfa_pyeong": round(below_pyeong, 2),
            "total_gfa_m2": round(total_gfa_m2, 2),
            "total_gfa_pyeong": round(total_gfa_pyeong, 2),
            "basement_floors": args.basement_floors,
        },
        "construction_cost_breakdown": {
            "building_type": args.building_type,
            "building_type_kr": b_info["name_kr"],
            "quality": args.quality,
            "kict_escalation_factor": round(kict_Escalation, 4),
            "above_unit_cost_krw_per_pyeong": round(above_unit_krw_py),
            "below_base_unit_cost_krw_per_pyeong": round(below_base_krw_py),
            "basement_depth_multiplier": depth_mult,
            "below_effective_unit_cost_krw_per_pyeong": round(below_effective_krw_py),
            "above_construction_eok_krw": round(above_construction_krw / EOK, 2),
            "below_construction_eok_krw": round(below_construction_krw / EOK, 2),
            "demolition_eok_krw": round(demolition_krw / EOK, 2),
            "direct_construction_total_eok_krw": round(direct_construction_krw / EOK, 2),
            "blended_cost_man_krw_per_pyeong": round(blended_cost_per_pyeong / MAN, 1),
            "blended_cost_krw_per_m2": round(blended_cost_per_m2),
        },
        "total_development_cost_eok_krw": {
            "1_land_purchase_eok": round(land_purchase_krw / EOK, 2),
            "1b_land_tax_and_fees_eok": round((land_acq_tax_krw + land_brokerage_legal_krw) / EOK, 2),
            "1_total_land_cost_eok": round(total_land_cost_krw / EOK, 2),
            "2_direct_construction_eok": round(direct_construction_krw / EOK, 2),
            "3_soft_costs_and_taxes_eok": round(total_soft_cost_krw / EOK, 2),
            "4_contingency_eok": round(contingency_krw / EOK, 2),
            "5_pf_financing_eok": round(pf_financing_krw / EOK, 2),
            "total_development_cost_eok": round(total_development_cost_krw / EOK, 2),
        },
        "feasibility_and_valuation": {
            "leasable_contract_pyeong": round(leasable_contract_pyeong, 2),
            "monthly_rent_krw_per_pyeong": round(args.rent_krw_per_contract_pyeong),
            "total_security_deposit_eok": round(total_deposit_krw / EOK, 2),
            "gross_potential_income_eok_yr": round(gross_potential_income_krw / EOK, 2),
            "vacancy_pct": args.vacancy_pct,
            "effective_gross_income_eok_yr": round(effective_gross_income_krw / EOK, 2),
            "landlord_opex_eok_yr": round(annual_landlord_opex_krw / EOK, 2),
            "net_operating_income_noi_eok_yr": round(noi_krw / EOK, 2),
            "yield_on_cost_pct": round(yield_on_cost_pct, 2),
            "exit_cap_rate_pct": args.exit_cap_rate_pct,
            "yield_spread_bps": round(yield_spread_bps, 0),
            "stabilized_asset_value_eok": round(stabilized_asset_value_krw / EOK, 2),
            "development_profit_eok": round(development_profit_krw / EOK, 2),
            "development_margin_pct": round(development_margin_pct, 2),
        },
        "evidence_records": [
            {
                "source_name": "한국건설기술연구원 건설공사비지수 및 국내 개발사업 표준 원가모형",
                "issuing_authority": "한국건설기술연구원(KICT) / 사용자 입력 가정",
                "reference_date": today,
                "retrieved_at": today,
                "spatial_unit": "대한민국 (KRW 기준)",
                "verification_status": "ASSUMED",
            }
        ],
    }


def format_output(res):
    a = res["areas"]
    c = res["construction_cost_breakdown"]
    tdc = res["total_development_cost_eok_krw"]
    f = res["feasibility_and_valuation"]

    lines = [
        "=== Korean Construction Cost & Development Feasibility Calculator (KRW) ===",
        f"Building Type / Quality:  {c['building_type_kr']} ({c['quality'].capitalize()}) | KICT Escalation: {c['kict_escalation_factor']:.3f}x",
        f"Site Area (대지면적):      {a['site_area_m2']:,.1f} m2 ({a['site_area_pyeong']:,.1f} 평)",
        f"Above-Ground GFA (지상):  {a['above_gfa_m2']:,.1f} m2 ({a['above_gfa_pyeong']:,.1f} 평)",
        f"Basement GFA (지하 {a['basement_floors']}층):  {a['basement_gfa_m2']:,.1f} m2 ({a['basement_gfa_pyeong']:,.1f} 평)",
        f"Total GFA (총연면적):      {a['total_gfa_m2']:,.1f} m2 ({a['total_gfa_pyeong']:,.1f} 평)",
        "---------------------------------------------------------------------------",
        "[1. 직접공사비 분리 산정 (Above vs Basement + Earth Retention)]",
        f"  - 지상층 공사단가:       {c['above_unit_cost_krw_per_pyeong'] / MAN:,.0f} 만원/평 -> {c['above_construction_eok_krw']:,.2f} 억원",
        f"  - 지하층 유효단가:       {c['below_effective_unit_cost_krw_per_pyeong'] / MAN:,.0f} 만원/평 (심도계수 {c['basement_depth_multiplier']:.2f}x) -> {c['below_construction_eok_krw']:,.2f} 억원",
        f"  - 기존건물 철거비:       {c['demolition_eok_krw']:,.2f} 억원",
        f"  => 직접공사비 소계:      {c['direct_construction_total_eok_krw']:,.2f} 억원 (연면적 가중평균 {c['blended_cost_man_krw_per_pyeong']:,.1f} 만원/평 | {c['blended_cost_krw_per_m2']:,} 원/m2)",
        "---------------------------------------------------------------------------",
        "[2. 한국형 총사업비 구조 (Total Development Cost Breakdown)]",
        f"  (1) 토지비 및 취득부대비: {tdc['1_total_land_cost_eok']:>10,.2f} 억원 (매입 {tdc['1_land_purchase_eok']:,.2f}억 + 취득세·부대비 {tdc['1b_land_tax_and_fees_eok']:,.2f}억)",
        f"  (2) 직접공사비:          {tdc['2_direct_construction_eok']:>10,.2f} 억원",
        f"  (3) 설계·감리·인입·보존세:{tdc['3_soft_costs_and_taxes_eok']:>10,.2f} 억원",
        f"  (4) 예비비:              {tdc['4_contingency_eok']:>10,.2f} 억원",
        f"  (5) PF 금융비용:         {tdc['5_pf_financing_eok']:>10,.2f} 억원",
        f"  => 총사업비 합계 (TDC):  {tdc['total_development_cost_eok']:>10,.2f} 억원",
        "---------------------------------------------------------------------------",
        "[3. 임대 운용수지 및 투자수익성 (NOI & Exit Cap Rate Valuation)]",
        f"  - 임대계약면적:          {f['leasable_contract_pyeong']:,.1f} 평 (월임대료 {f['monthly_rent_krw_per_pyeong']:,} 원/평)",
        f"  - 임대보증금 총액:       {f['total_security_deposit_eok']:,.2f} 억원",
        f"  - 유효총수익 (EGI):      {f['effective_gross_income_eok_yr']:,.2f} 억원/년 (공실률 {f['vacancy_pct']:.1f}% 반영)",
        f"  - 임대인 운영경비 (OPEX): {f['landlord_opex_eok_yr']:,.2f} 억원/년 (재산세·종부세·PM·수선유지)",
        f"  => 순영업소득 (NOI):     {f['net_operating_income_noi_eok_yr']:,.2f} 억원/년",
        f"  => 총사업비 대비 수익률 (Yield on Cost): {f['yield_on_cost_pct']:.2f}% (Exit Cap {f['exit_cap_rate_pct']:.2f}% 대비 {f['yield_spread_bps']:+.0f} bps)",
        f"  => 준공 후 추정 자산가치: {f['stabilized_asset_value_eok']:,.2f} 억원",
        f"  => 추정 개발이익 (Margin): {f['development_profit_eok']:+,.2f} 억원 ({f['development_margin_pct']:+.1f}%)",
    ]
    return "\n".join(lines)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Korean Construction Cost & Feasibility Calculator (KRW)")
    parser.add_argument("--site-area-m2", type=float, required=True, help="Site area (m2)")
    parser.add_argument("--above-gfa-m2", type=float, required=True, help="Above-ground FAR GFA (m2)")
    parser.add_argument("--basement-gfa-m2", type=float, required=True, help="Underground GFA (m2)")
    parser.add_argument("--basement-floors", type=int, default=3, help="Number of basement floors (default: 3)")
    parser.add_argument("--building-type", choices=list(KR_BASE_COST_PER_PYEONG.keys()), default="office")
    parser.add_argument("--quality", choices=["basic", "standard", "premium"], default="standard")
    parser.add_argument("--kict-index-base", type=float, default=100.0, help="Base KICT Construction Cost Index")
    parser.add_argument("--kict-index-current", type=float, default=100.0, help="Current KICT Construction Cost Index")
    parser.add_argument("--override-above-cost-pyeong", type=float, default=None, help="Override above-ground KRW/pyeong")
    parser.add_argument("--override-below-cost-pyeong", type=float, default=None, help="Override base underground KRW/pyeong")
    parser.add_argument("--demolition-cost-per-site-pyeong", type=float, default=600_000, help="Existing building demolition cost per site pyeong (KRW)")
    parser.add_argument("--land-cost-krw-per-pyeong", type=float, required=True, help="Land purchase price per site pyeong (KRW)")
    parser.add_argument("--land-acq-tax-pct", type=float, default=4.6, help="Land acquisition tax rate (%, default 4.6%)")
    parser.add_argument("--design-supervision-pct", type=float, default=6.5, help="Design, CM, supervision, engineering (% of direct cost)")
    parser.add_argument("--utility-impact-fee-pct", type=float, default=3.5, help="Utility connection & statutory impact fees (% of direct cost)")
    parser.add_argument("--contingency-pct", type=float, default=5.0, help="Contingency (% of hard+soft cost)")
    parser.add_argument("--pf-interest-rate-pct", type=float, default=6.2, help="Annual PF / Bridge loan interest rate (%)")
    parser.add_argument("--construction-months", type=int, default=24, help="Construction duration in months")
    parser.add_argument("--leasable-ratio-to-above-gfa", type=float, default=1.0, help="Ratio of contract leasable area to above-ground GFA")
    parser.add_argument("--rent-krw-per-contract-pyeong", type=float, required=True, help="Monthly rent per contract pyeong (KRW)")
    parser.add_argument("--deposit-months", type=float, default=10.0, help="Security deposit in multiples of monthly rent")
    parser.add_argument("--deposit-yield-pct", type=float, default=3.5, help="Annual return on security deposit (%)")
    parser.add_argument("--vacancy-pct", type=float, default=5.0, help="Stabilized vacancy allowance (%)")
    parser.add_argument("--landlord-opex-ratio-pct", type=float, default=18.0, help="Unreimbursed landlord OPEX + property/comprehensive tax (% of EGI)")
    parser.add_argument("--exit-cap-rate-pct", type=float, default=4.5, help="Exit Cap Rate (%)")
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()
    result = calculate(args)

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))


if __name__ == "__main__":
    main()
