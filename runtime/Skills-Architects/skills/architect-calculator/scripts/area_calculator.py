#!/usr/bin/env python3
"""
Area & Density Calculator

Calculates development density metrics from site area and floor area ratio:
  - Gross Floor Area (GFA) from site area and FAR
  - Net Gross Area (NGA) from GFA and net-to-gross ratio
  - Residential unit count from NGA and average unit size
  - Estimated population from units and persons per household
  - Required parking spaces from units and parking ratio

Usage:
    python area_calculator.py --site-area 5000 --far 2.5
    python area_calculator.py --site-area 5000 --far 2.5 --ntg-ratio 0.82 --json
"""

import argparse
import json
import math
import sys
from calculator_inputs import finite_float, safe_json_dumps, run_cli, ensure_finite_output, is_finite_number, strict_json_loads, validate_measurements


def normalize_far(args):
    """Normalize FAR whether given as ratio (e.g. 2.5) or percentage (e.g. 250)."""
    warnings = []
    if getattr(args, "far_pct", None) is not None:
        far_ratio = args.far_pct / 100.0
        far_pct = args.far_pct
    else:
        raw_far = args.far
        if raw_far > 20.0:
            far_ratio = raw_far / 100.0
            far_pct = raw_far
            warnings.append(
                f"FAR input {raw_far} exceeds 20.0; automatically converted from "
                f"percentage ({raw_far}%) to ratio ({far_ratio:.2f})."
            )
        else:
            far_ratio = raw_far
            far_pct = raw_far * 100.0
    return far_ratio, far_pct, warnings


def validate_inputs(args):
    """Validate all input parameters."""
    errors = validate_measurements(args, ('site_area', 'far', 'far_pct', 'building_area', 'bcr', 'basement_area', 'ntg_ratio', 'avg_unit_size', 'persons_per_unit', 'parking_ratio'), optional=('far', 'far_pct', 'building_area', 'bcr'))
    if errors:
        return errors
    if args.site_area <= 0:
        errors.append("Site area must be a positive number.")
    if args.far is None and getattr(args, "far_pct", None) is None:
        errors.append("Either --far (ratio) or --far-pct (%) is required.")
    if args.far is not None and args.far <= 0:
        errors.append("Floor area ratio (FAR) must be a positive number.")
    if getattr(args, "far_pct", None) is not None and args.far_pct <= 0:
        errors.append("FAR percentage (--far-pct) must be a positive number.")
    if getattr(args, "building_area", None) is not None:
        if args.building_area <= 0:
            errors.append("Building footprint area (--building-area) must be positive.")
        elif args.building_area > args.site_area:
            errors.append("Building footprint area cannot exceed site area.")
    if getattr(args, "bcr", None) is not None:
        bcr_val = args.bcr * 100.0 if args.bcr <= 1.0 else args.bcr
        if not (0.0 < bcr_val <= 100.0):
            errors.append("Building coverage ratio (--bcr) must be between 0 and 100%.")
    if getattr(args, "basement_area", 0.0) < 0:
        errors.append("Basement area (--basement-area) cannot be negative.")
    if not (0.0 < args.ntg_ratio <= 1.0):
        errors.append("Net-to-gross ratio must be between 0.0 (exclusive) and 1.0 (inclusive).")
    if args.avg_unit_size <= 0:
        errors.append("Average unit size must be a positive number.")
    if args.persons_per_unit <= 0:
        errors.append("Persons per unit must be a positive number.")
    if args.parking_ratio < 0:
        errors.append("Parking ratio cannot be negative.")
    return errors


def calculate(args):
    """Perform area and density calculations."""
    far_ratio, far_pct, warnings = normalize_far(args)
    far_gfa = args.site_area * far_ratio
    basement_area = getattr(args, "basement_area", 0.0) or 0.0
    total_gfa = far_gfa + basement_area
    nga = far_gfa * args.ntg_ratio
    units = math.floor(nga / args.avg_unit_size)
    population = units * args.persons_per_unit
    parking = math.ceil(units * args.parking_ratio)

    # Site coverage (BCR / 건폐율): only compute when building_area or bcr is given
    building_area = getattr(args, "building_area", None)
    bcr_input = getattr(args, "bcr", None)
    if building_area is not None:
        site_coverage_pct = round((building_area / args.site_area) * 100.0, 2)
        building_footprint_m2 = round(building_area, 2)
        coverage_status = "CALCULATED"
    elif bcr_input is not None:
        site_coverage_pct = round(bcr_input * 100.0 if bcr_input <= 1.0 else bcr_input, 2)
        building_footprint_m2 = round(args.site_area * (site_coverage_pct / 100.0), 2)
        coverage_status = "FROM_BCR_INPUT"
    else:
        site_coverage_pct = None
        building_footprint_m2 = None
        coverage_status = "NEEDS_VERIFICATION (provide --building-area or --bcr)"

    result = {
        "site_area_m2": round(args.site_area, 2),
        "far": round(far_ratio, 2),
        "far_pct": round(far_pct, 2),
        "far_countable_gfa_m2": round(far_gfa, 2),
        "basement_area_m2": round(basement_area, 2),
        "gross_floor_area_m2": round(total_gfa, 2),
        "building_footprint_m2": building_footprint_m2,
        "site_coverage_pct": site_coverage_pct,
        "site_coverage_status": coverage_status,
        "ntg_ratio": round(args.ntg_ratio, 2),
        "net_gross_area_m2": round(nga, 2),
        "avg_unit_size_m2": round(args.avg_unit_size, 2),
        "estimated_units": units,
        "persons_per_unit": round(args.persons_per_unit, 2),
        "estimated_population": round(population, 1),
        "parking_ratio": round(args.parking_ratio, 2),
        "parking_spaces": parking,
        "density_units_per_hectare": round(units / (args.site_area / 10000), 1)
            if args.site_area > 0 else 0,
        "density_persons_per_hectare": round(population / (args.site_area / 10000), 1)
            if args.site_area > 0 else 0,
    }
    if warnings:
        result["warnings"] = warnings
    return result


def format_output(result):
    """Format results for human-readable output."""
    cov_str = (
        f"{result['site_coverage_pct']:.2f}% ({result['building_footprint_m2']:,.2f} m2)"
        if result["site_coverage_pct"] is not None
        else f"N/A [{result['site_coverage_status']}]"
    )
    lines = [
        "=== Area & Density Calculator ===",
        f"Site Area:            {result['site_area_m2']:,.2f} m2",
        f"Floor Area Ratio:     {result['far']:.2f} ({result['far_pct']:.1f}%)",
        f"Site Coverage (BCR):  {cov_str}",
        "---------------------------------------",
        f"FAR-Countable GFA:    {result['far_countable_gfa_m2']:,.2f} m2",
        f"Basement / Excl GFA:  {result['basement_area_m2']:,.2f} m2",
        f"Total Gross Floor Area: {result['gross_floor_area_m2']:,.2f} m2",
        f"Net-to-Gross Ratio:   {result['ntg_ratio']:.2f}",
        f"Net Gross Area:       {result['net_gross_area_m2']:,.2f} m2",
        "---------------------------------------",
        f"Average Unit Size:    {result['avg_unit_size_m2']:.2f} m2",
        f"Estimated Units:      {result['estimated_units']:,}",
        f"Persons per Unit:     {result['persons_per_unit']:.2f}",
        f"Estimated Population: {result['estimated_population']:,.0f}",
        "---------------------------------------",
        f"Parking Ratio:        {result['parking_ratio']:.2f} spaces/unit",
        f"Parking Spaces:       {result['parking_spaces']:,}",
        "---------------------------------------",
        f"Density:              {result['density_units_per_hectare']:.1f} units/hectare",
        f"                      {result['density_persons_per_hectare']:.1f} persons/hectare",
    ]
    if result.get("warnings"):
        lines.append("---------------------------------------")
        for w in result["warnings"]:
            lines.append(f"WARNING: {w}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Area & Density Calculator: compute GFA, NGA, unit count, "
                    "population, and parking from site area and FAR."
    )
    parser.add_argument("--site-area", type=finite_float, required=True,
                        help="Total site/plot area in m2")
    parser.add_argument("--far", type=finite_float, default=None,
                        help="Floor area ratio (plot ratio, e.g. 2.5; values >20 auto-convert from %%)")
    parser.add_argument("--far-pct", type=finite_float, default=None,
                        help="Floor area ratio in percentage (e.g. 250 for 250%%)")
    parser.add_argument("--building-area", type=finite_float, default=None,
                        help="Building footprint area (건축면적) in m2 for accurate site coverage")
    parser.add_argument("--bcr", type=finite_float, default=None,
                        help="Building coverage ratio (건폐율) in %% (e.g. 60) or ratio (0.60)")
    parser.add_argument("--basement-area", type=finite_float, default=0.0,
                        help="Basement floor area excluded from FAR but included in total GFA (m2)")
    parser.add_argument("--ntg-ratio", type=finite_float, default=0.80,
                        help="Net-to-gross ratio (default: 0.80)")
    parser.add_argument("--avg-unit-size", type=finite_float, default=85.0,
                        help="Average residential unit size in m2 (default: 85)")
    parser.add_argument("--persons-per-unit", type=finite_float, default=2.5,
                        help="Average persons per dwelling unit (default: 2.5)")
    parser.add_argument("--parking-ratio", type=finite_float, default=1.0,
                        help="Parking spaces per dwelling unit (default: 1.0)")
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
        print(safe_json_dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))


if __name__ == "__main__":
    run_cli(main)

