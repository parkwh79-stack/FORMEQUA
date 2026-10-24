#!/usr/bin/env python3
"""
Structural Load Calculator

Calculates preliminary gravity loads for column sizing:
  - Dead load and live load per floor
  - Total load per floor from tributary area
  - Cumulative column load for multi-story
  - Factored load (1.2D + 1.6L per ASCE 7 / IBC)
  - Preliminary RC column sizing

Usage:
    python structural_load_calculator.py --tributary-area 36 --num-floors 8
    python structural_load_calculator.py --tributary-area 36 --num-floors 8 --occupancy-type office --json
"""

import argparse
import json
import math
import sys
from calculator_inputs import finite_float, safe_json_dumps, run_cli, ensure_finite_output, is_finite_number, strict_json_loads, validate_measurements


# Typical live loads by occupancy type (kN/m2, aligned with KDS 41 12 00 & IBC)
LIVE_LOADS = {
    "residential":  {"load": 2.0, "name": "Residential (KDS 2.0 / IBC 1.9)"},
    "office":       {"load": 2.5, "name": "Office (KDS 2.5 / IBC 2.4)"},
    "retail":       {"load": 4.8, "name": "Retail (ground floor)"},
    "assembly":     {"load": 4.8, "name": "Assembly"},
    "storage":      {"load": 6.0, "name": "Storage (light)"},
    "parking":      {"load": 2.5, "name": "Parking garage (passenger)"},
    "hospital":     {"load": 3.8, "name": "Hospital"},
    "school":       {"load": 3.0, "name": "School/classroom (KDS 3.0)"},
    "hotel":        {"load": 2.0, "name": "Hotel guest rooms"},
    "library":      {"load": 7.5, "name": "Library stack rooms (KDS 7.5)"},
    "industrial":   {"load": 6.0, "name": "Industrial, light"},
}


def validate_inputs(args):
    """Validate all input parameters."""
    errors = validate_measurements(args, ('tributary_area', 'dead_load', 'live_load'), optional=('live_load',))
    if errors:
        return errors
    if args.tributary_area <= 0:
        errors.append("Tributary area must be a positive number.")
    if args.num_floors < 1:
        errors.append("Number of floors must be at least 1.")
    if args.dead_load <= 0:
        errors.append("Dead load must be a positive number.")
    occ = args.occupancy_type.lower()
    if occ not in LIVE_LOADS and args.live_load is None:
        valid = ", ".join(sorted(LIVE_LOADS.keys()))
        errors.append(f"Unknown occupancy type '{args.occupancy_type}'. "
                      f"Valid types: {valid}. "
                      f"Or specify --live-load directly.")
    if args.live_load is not None and args.live_load <= 0:
        errors.append("Live load must be a positive number.")
    return errors


def calculate(args):
    """Perform structural load calculations."""
    occ = args.occupancy_type.lower()

    # Determine live load
    if args.live_load is not None:
        live_load = args.live_load
        occ_name = "User-specified"
    elif occ in LIVE_LOADS:
        live_load = LIVE_LOADS[occ]["load"]
        occ_name = LIVE_LOADS[occ]["name"]
    else:
        live_load = 2.5  # default to office
        occ_name = "Default (office)"

    dead_load = args.dead_load
    total_per_floor = dead_load + live_load

    # Load per floor
    load_per_floor = args.tributary_area * total_per_floor

    # Total column load (unfactored)
    total_column_load = load_per_floor * args.num_floors

    # Factored load (ASCE 7 / KDS 41 12 00 LRFD: 1.2D + 1.6L)
    factored_per_floor = args.tributary_area * (1.2 * dead_load + 1.6 * live_load)
    factored_total = factored_per_floor * args.num_floors

    # Preliminary column sizing (RC tied column with ~2% reinforcement ratio, fy=400 MPa)
    # Pu = phi * 0.80 * (0.85 * fc' * (Ag - Ast) + fy * Ast), phi = 0.65, rho_g = 0.02
    fc_prime = 35.0  # MPa
    fy = 400.0       # MPa
    rho_g = 0.02
    phi = 0.65
    effective_stress_mpa = phi * 0.80 * (0.85 * fc_prime * (1.0 - rho_g) + fy * rho_g)
    ag_required_mm2 = (factored_total * 1000.0) / effective_stress_mpa  # convert kN to N
    column_dim_mm = math.ceil(math.sqrt(ag_required_mm2) / 50) * 50  # round up to 50mm

    # Minimum column dimension
    column_dim_mm = max(column_dim_mm, 300)

    # Tributary area dimensions (assuming square)
    trib_dim = math.sqrt(args.tributary_area)

    return {
        "tributary_area_m2": round(args.tributary_area, 2),
        "tributary_dimension_m": round(trib_dim, 2),
        "num_floors": args.num_floors,
        "occupancy_type": occ_name,
        "dead_load_kN_m2": round(dead_load, 2),
        "live_load_kN_m2": round(live_load, 2),
        "total_load_kN_m2": round(total_per_floor, 2),
        "load_per_floor_kN": round(load_per_floor, 2),
        "total_column_load_kN": round(total_column_load, 2),
        "factored_load_kN": round(factored_total, 2),
        "factored_load_formula": "1.2D + 1.6L",
        "preliminary_column_mm": column_dim_mm,
        "preliminary_column_desc": f"~{column_dim_mm}x{column_dim_mm} mm RC (fc'={fc_prime:.0f} MPa)",
        "concrete_strength_MPa": fc_prime,
        "ag_required_mm2": round(ag_required_mm2),
        "kr_structural_note": (
            "Gravity load preliminary sizing only. Does NOT include seismic (KDS 41 17 00), "
            "wind (KDS 41 12 00), snow, slenderness, or moment frame effects."
        ),
    }


def format_output(result):
    """Format results for human-readable output."""
    lines = [
        "=== Structural Load Calculator ===",
        f"Tributary Area:    {result['tributary_area_m2']:,.2f} m2 "
        f"(~{result['tributary_dimension_m']:.1f}m x {result['tributary_dimension_m']:.1f}m)",
        f"Number of Floors:  {result['num_floors']}",
        f"Occupancy:         {result['occupancy_type']}",
        "---------------------------------------",
        f"Dead Load:         {result['dead_load_kN_m2']:.2f} kN/m2 per floor",
        f"Live Load:         {result['live_load_kN_m2']:.2f} kN/m2 per floor",
        f"Total per Floor:   {result['total_load_kN_m2']:.2f} kN/m2",
        "---------------------------------------",
        f"Load per Floor:    {result['load_per_floor_kN']:,.2f} kN",
        f"Total Column Load: {result['total_column_load_kN']:,.2f} kN ({result['num_floors']} floors)",
        f"Factored Load:     {result['factored_load_kN']:,.2f} kN ({result['factored_load_formula']})",
        "---------------------------------------",
        f"Preliminary Column: {result['preliminary_column_desc']}",
        f"Required Ag:        {result['ag_required_mm2']:,.0f} mm2",
        "",
        "Note: Preliminary sizing only. Detailed structural analysis required.",
        "Column size assumes tied RC column with ~2% reinforcement ratio.",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Structural Load Calculator: compute tributary area gravity "
                    "loads and preliminary column sizing."
    )
    parser.add_argument("--tributary-area", type=finite_float, required=True,
                        help="Column tributary area in m2")
    parser.add_argument("--num-floors", type=int, required=True,
                        help="Number of floors supported by column")
    parser.add_argument("--dead-load", type=finite_float, default=4.5,
                        help="Dead load per floor in kN/m2 (default: 4.5 for RC slab)")
    parser.add_argument("--live-load", type=finite_float, default=None,
                        help="Live load in kN/m2 (overrides occupancy-based value)")
    parser.add_argument("--occupancy-type", type=str, default="office",
                        help="Occupancy type for auto live load "
                             "(residential/office/retail/assembly/storage/parking/"
                             "hospital/school/hotel/library/industrial)")
    parser.add_argument("--json", action="store_true",
                        help="Output results as JSON")

    args = parser.parse_args()

    errors = validate_inputs(args)
    if errors:
        for error in errors:
            print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)

    result = calculate(args)

    ensure_finite_output(result)
    if args.json:
        print(safe_json_dumps(result, indent=2))
    else:
        print(format_output(result))


if __name__ == "__main__":
    run_cli(main)
