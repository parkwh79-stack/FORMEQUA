#!/usr/bin/env python3
"""
Energy Calculator

Estimates annual heating and cooling energy demand using the degree-day
method. Accounts for transmission losses through the building envelope,
ventilation losses, and internal heat gains.

Usage:
    python energy_calculator.py --floor-area 500 --envelope-area 800 \\
        --average-u-value 0.35 --heating-degree-days 3000 --cooling-degree-days 500
    python energy_calculator.py --floor-area 500 --envelope-area 800 \\
        --average-u-value 0.35 --heating-degree-days 3000 --cooling-degree-days 500 --json
"""

import argparse
import json
import sys
from calculator_inputs import finite_float, safe_json_dumps, run_cli, ensure_finite_output, is_finite_number, strict_json_loads, validate_measurements


# Korean regional degree-day presets (KMA ASOS representative normals, base 18C HDD / 24C CDD)
KR_CLIMATE_PRESETS = {
    "seoul":   {"name": "서울 (중부2지역)", "hdd": 2650.0, "cdd": 420.0},
    "incheon": {"name": "인천 (중부2지역)", "hdd": 2600.0, "cdd": 360.0},
    "daejeon": {"name": "대전 (중부2지역)", "hdd": 2480.0, "cdd": 430.0},
    "chuncheon": {"name": "춘천 (중부1지역)", "hdd": 2950.0, "cdd": 350.0},
    "daegu":   {"name": "대구 (남부지역)", "hdd": 2150.0, "cdd": 560.0},
    "gwangju": {"name": "광주 (남부지역)", "hdd": 2100.0, "cdd": 490.0},
    "busan":   {"name": "부산 (남부지역)", "hdd": 1750.0, "cdd": 450.0},
    "jeju":    {"name": "제주 (제주도)", "hdd": 1450.0, "cdd": 580.0},
}


def validate_inputs(args):
    """Validate all input parameters."""
    errors = validate_measurements(args, ('floor_area', 'envelope_area', 'average_u_value', 'heating_degree_days', 'cooling_degree_days', 'ventilation_rate', 'internal_gains'), optional=('heating_degree_days', 'cooling_degree_days'))
    if errors:
        return errors
    if args.floor_area <= 0:
        errors.append("Floor area must be a positive number.")
    if args.envelope_area <= 0:
        errors.append("Envelope area must be a positive number.")
    if args.average_u_value <= 0:
        errors.append("Average U-value must be a positive number.")
    if args.kr_city:
        if args.kr_city.lower() not in KR_CLIMATE_PRESETS:
            valid = ", ".join(KR_CLIMATE_PRESETS.keys())
            errors.append(f"Invalid --kr-city '{args.kr_city}'. Valid cities: {valid}")
    else:
        if args.heating_degree_days is None or args.heating_degree_days < 0:
            errors.append("Heating degree days (--heating-degree-days) is required and cannot be negative.")
        if args.cooling_degree_days is None or args.cooling_degree_days < 0:
            errors.append("Cooling degree days (--cooling-degree-days) is required and cannot be negative.")
    if args.ventilation_rate < 0:
        errors.append("Ventilation rate cannot be negative.")
    if args.internal_gains < 0:
        errors.append("Internal gains cannot be negative.")
    return errors


def calculate(args):
    """Perform energy demand calculations using degree-day method."""
    if args.kr_city:
        preset = KR_CLIMATE_PRESETS[args.kr_city.lower()]
        hdd = args.heating_degree_days if args.heating_degree_days is not None else preset["hdd"]
        cdd = args.cooling_degree_days if args.cooling_degree_days is not None else preset["cdd"]
        climate_source = f"KMA ASOS Preset: {preset['name']}"
    else:
        hdd = args.heating_degree_days
        cdd = args.cooling_degree_days
        climate_source = "User-specified HDD/CDD"

    # Assumed ceiling height for volume calculation
    ceiling_height = 3.0  # meters
    volume = args.floor_area * ceiling_height  # m3

    # Transmission heat loss coefficient (W/K)
    transmission_coeff = args.average_u_value * args.envelope_area

    # Ventilation heat loss coefficient (W/K)
    # Q_vent = 0.3375 * n * V (rho_air * cp_air / 3600)
    ventilation_coeff = 0.3375 * args.ventilation_rate * volume

    # Total heat loss coefficient
    total_loss_coeff = transmission_coeff + ventilation_coeff

    # Annual transmission and ventilation loss (kWh/yr)
    transmission_loss = transmission_coeff * hdd * 24 / 1000
    ventilation_loss = ventilation_coeff * hdd * 24 / 1000

    # Useful internal gains offset during heating season (kWh/yr)
    # Effective utilization factor applied to annual hours based on HDD/3000 scaling
    effective_heating_hours = 876.0 * (hdd / 3000.0) if hdd > 0 else 0.0
    internal_gains_annual = args.internal_gains * args.floor_area * effective_heating_hours / 1000

    # Heating demand
    heating_demand = max(0, transmission_loss + ventilation_loss - internal_gains_annual)

    # Cooling demand (transmission + ventilation + effective internal/solar gains during cooling)
    cooling_transmission = transmission_coeff * cdd * 24 / 1000
    cooling_ventilation = ventilation_coeff * cdd * 24 / 1000
    effective_cooling_hours = 224.8 * (cdd / 500.0) if cdd > 0 else 0.0
    cooling_internal_solar = args.internal_gains * args.floor_area * effective_cooling_hours / 1000
    cooling_demand = max(0, cooling_transmission + cooling_ventilation + cooling_internal_solar)

    # Total demand and EUI
    total_demand = heating_demand + cooling_demand
    eui = total_demand / args.floor_area if args.floor_area > 0 else 0

    # Passive House compliance check
    heating_eui = heating_demand / args.floor_area if args.floor_area > 0 else 0
    cooling_eui = cooling_demand / args.floor_area if args.floor_area > 0 else 0
    meets_passive_house_heating = heating_eui <= 15.0
    meets_passive_house_cooling = cooling_eui <= 15.0

    # Heat loss per unit floor area
    specific_heat_loss = total_loss_coeff / args.floor_area if args.floor_area > 0 else 0

    return {
        "climate_source": climate_source,
        "floor_area_m2": round(args.floor_area, 2),
        "envelope_area_m2": round(args.envelope_area, 2),
        "average_u_value_W_m2K": round(args.average_u_value, 4),
        "building_volume_m3": round(volume, 2),
        "heating_degree_days": round(hdd, 1),
        "cooling_degree_days": round(cdd, 1),
        "ventilation_rate_ACH": round(args.ventilation_rate, 2),
        "internal_gains_W_m2": round(args.internal_gains, 2),
        "transmission_loss_coeff_W_K": round(transmission_coeff, 2),
        "ventilation_loss_coeff_W_K": round(ventilation_coeff, 2),
        "total_loss_coeff_W_K": round(total_loss_coeff, 2),
        "specific_heat_loss_W_m2K": round(specific_heat_loss, 4),
        "transmission_loss_kWh": round(transmission_loss, 2),
        "ventilation_loss_kWh": round(ventilation_loss, 2),
        "internal_gains_offset_kWh": round(internal_gains_annual, 2),
        "heating_demand_kWh": round(heating_demand, 2),
        "cooling_demand_kWh": round(cooling_demand, 2),
        "total_demand_kWh": round(total_demand, 2),
        "eui_kWh_m2_yr": round(eui, 2),
        "heating_eui_kWh_m2_yr": round(heating_eui, 2),
        "cooling_eui_kWh_m2_yr": round(cooling_eui, 2),
        "meets_passive_house_heating": meets_passive_house_heating,
        "meets_passive_house_cooling": meets_passive_house_cooling,
        "passive_house_target_kWh_m2": 15.0,
        "kr_zeb_note": (
            "eui_kWh_m2_yr is preliminary heating/cooling thermal demand. "
            "Do NOT equate directly with Korea ZEB Primary Energy (1차에너지소요량, which includes "
            "HVAC plant efficiency, lighting, DHW, ventilation fans, renewables, and primary energy factors) "
            "or actual metered electricity/gas bills."
        ),
    }


def format_output(result):
    """Format results for human-readable output."""
    lines = [
        "=== Energy Calculator ===",
        f"Climate Source:       {result['climate_source']}",
        f"Floor Area:           {result['floor_area_m2']:,.2f} m2",
        f"Envelope Area:        {result['envelope_area_m2']:,.2f} m2",
        f"Average U-value:      {result['average_u_value_W_m2K']:.2f} W/m2K",
        "---------------------------------------",
        f"Heating Degree Days:  {result['heating_degree_days']:,.0f} Kd",
        f"Cooling Degree Days:  {result['cooling_degree_days']:,.0f} Kd",
        f"Ventilation Rate:     {result['ventilation_rate_ACH']:.2f} ACH",
        f"Internal Gains:       {result['internal_gains_W_m2']:.2f} W/m2",
        "---------------------------------------",
        f"Transmission Loss:    {result['transmission_loss_kWh']:,.2f} kWh/yr",
        f"Ventilation Loss:     {result['ventilation_loss_kWh']:,.2f} kWh/yr",
        f"Internal Gains:       -{result['internal_gains_offset_kWh']:,.2f} kWh/yr",
        f"Heating Demand:       {result['heating_demand_kWh']:,.2f} kWh/yr",
        "---------------------------------------",
        f"Cooling Demand:       {result['cooling_demand_kWh']:,.2f} kWh/yr",
        "---------------------------------------",
        f"Total Demand:         {result['total_demand_kWh']:,.2f} kWh/yr",
        f"EUI:                  {result['eui_kWh_m2_yr']:.2f} kWh/m2/yr",
        "",
        f"Passive House target: {result['passive_house_target_kWh_m2']:.0f} kWh/m2/yr -- "
        f"{'MEETS TARGET' if (result['meets_passive_house_heating'] and result['meets_passive_house_cooling']) else 'DOES NOT MEET'}",
        f"Note: {result['kr_zeb_note']}",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Energy Calculator: estimate annual heating and cooling "
                    "demand using the degree-day method."
    )
    parser.add_argument("--floor-area", type=finite_float, required=True,
                        help="Conditioned floor area in m2")
    parser.add_argument("--envelope-area", type=finite_float, required=True,
                        help="Total building envelope area in m2 "
                             "(walls + roof + floor)")
    parser.add_argument("--average-u-value", type=finite_float, required=True,
                        help="Area-weighted average U-value in W/m2K")
    parser.add_argument("--heating-degree-days", type=finite_float, default=None,
                        help="Annual heating degree days (base 18C) in Kd")
    parser.add_argument("--cooling-degree-days", type=finite_float, default=None,
                        help="Annual cooling degree days (base 24C) in Kd")
    parser.add_argument("--kr-city", "--kr-climate", dest="kr_city", type=str, default=None,
                        help="Korean city preset (seoul, incheon, daejeon, chuncheon, daegu, gwangju, busan, jeju)")
    parser.add_argument("--ventilation-rate", type=finite_float, default=0.5,
                        help="Ventilation rate in air changes per hour (default: 0.5)")
    parser.add_argument("--internal-gains", type=finite_float, default=5.0,
                        help="Internal heat gains in W/m2 (default: 5.0)")
    parser.add_argument("--json", action="store_true",
                        help="Output results as JSON")

    args = parser.parse_args()

    errors = validate_inputs(args)
    if errors:
        for error in errors:
            print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)

    result = calculate(args)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ensure_finite_output(result)
    if args.json:
        print(safe_json_dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))


if __name__ == "__main__":
    run_cli(main)

