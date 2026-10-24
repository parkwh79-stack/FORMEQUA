#!/usr/bin/env python3
"""
Daylight Factor Calculator

Estimates the average daylight factor for a side-lit room using the BRE
simplified formula:

    DF = (Aw * T * theta) / (A_total * (1 - R^2)) * 100

Where:
    Aw      = net glazed area of window (m2)
    T       = glazing transmittance
    theta   = visible sky angle factor (0.0 - 1.0)
    A_total = total area of all room surfaces (m2)
    R       = area-weighted average reflectance of room surfaces

Usage:
    python daylight_calculator.py --room-width 4 --room-depth 6 --room-height 3 \\
        --window-width 2.5 --window-height 1.8 --window-sill-height 0.9
    python daylight_calculator.py --room-width 4 --room-depth 6 --room-height 3 \\
        --window-width 2.5 --window-height 1.8 --window-sill-height 0.9 --json
"""

import argparse
import json
import math
import sys
from calculator_inputs import finite_float, safe_json_dumps, run_cli, ensure_finite_output, is_finite_number, strict_json_loads, validate_measurements


def validate_inputs(args):
    """Validate all input parameters."""
    errors = validate_measurements(args, ('room_width', 'room_depth', 'room_height', 'window_width', 'window_height', 'window_sill_height', 'glazing_transmittance', 'average_reflectance', 'obstruction_angle', 'sky_angle'), optional=('sky_angle',))
    if errors:
        return errors
    if args.room_width <= 0:
        errors.append("Room width must be positive.")
    if args.room_depth <= 0:
        errors.append("Room depth must be positive.")
    if args.room_height <= 0:
        errors.append("Room height must be positive.")
    if args.window_width <= 0:
        errors.append("Window width must be positive.")
    if args.window_height <= 0:
        errors.append("Window height must be positive.")
    if args.window_sill_height < 0:
        errors.append("Window sill height cannot be negative.")
    if args.window_sill_height + args.window_height > args.room_height:
        errors.append("Window head height (sill + window height) exceeds room height.")
    if args.window_width > args.room_width:
        errors.append("Window width exceeds room width.")
    if not (0.0 < args.glazing_transmittance <= 1.0):
        errors.append("Glazing transmittance must be between 0.0 (exclusive) and 1.0.")
    if not (0.0 < args.average_reflectance < 1.0):
        errors.append("Average reflectance must be between 0.0 and 1.0 (exclusive).")
    if not 0.0 <= args.obstruction_angle <= 90.0:
        errors.append("Obstruction angle must be between 0 and 90 degrees.")
    if args.sky_angle is not None and not 0.0 <= args.sky_angle <= 90.0:
        errors.append("Visible sky angle must be between 0 and 90 degrees.")
    return errors


def calculate(args):
    """Perform daylight factor calculation."""
    # Window area
    window_area = args.window_width * args.window_height

    # Total room surface area
    floor_area = args.room_width * args.room_depth
    ceiling_area = floor_area
    wall_long = 2 * (args.room_depth * args.room_height)
    wall_short = 2 * (args.room_width * args.room_height)
    total_surface_area = floor_area + ceiling_area + wall_long + wall_short

    # Window-to-floor ratio
    window_to_floor = (window_area / floor_area) * 100

    # Visible sky angle calculation
    # Unobstructed sky angle from window center, adjusted by room depth & external obstruction
    window_head = args.window_sill_height + args.window_height
    window_mid = args.window_sill_height + args.window_height / 2
    if getattr(args, "sky_angle", None) is not None:
        theta_deg = args.sky_angle
    else:
        base_obstruction_deg = math.degrees(math.atan2(window_mid, args.room_depth * 0.52))
        ext_obstruction_deg = getattr(args, "obstruction_angle", 0.0) or 0.0
        theta_deg = max(5.0, 90.0 - base_obstruction_deg - ext_obstruction_deg)
    theta_factor = (theta_deg / 90.0) * 0.8625  # includes standard framing/dirt maintenance factor

    # BRE daylight factor formula
    r = args.average_reflectance
    denominator = total_surface_area * (1 - r * r)

    if denominator <= 0:
        daylight_factor = 0.0
    else:
        daylight_factor = (window_area * args.glazing_transmittance * theta_factor) / denominator * 100

    # Assessment
    if daylight_factor >= 5.0:
        assessment = "EXCELLENT (well daylit)"
    elif daylight_factor >= 2.0:
        assessment = "ADEQUATE (target >= 2.0% for habitable rooms)"
    elif daylight_factor >= 1.0:
        assessment = "MARGINAL (below 2.0% target for habitable rooms)"
    else:
        assessment = "POOR (supplementary electric lighting required)"

    return {
        "room_width_m": round(args.room_width, 2),
        "room_depth_m": round(args.room_depth, 2),
        "room_height_m": round(args.room_height, 2),
        "window_width_m": round(args.window_width, 2),
        "window_height_m": round(args.window_height, 2),
        "window_sill_height_m": round(args.window_sill_height, 2),
        "window_area_m2": round(window_area, 2),
        "floor_area_m2": round(floor_area, 2),
        "total_surface_area_m2": round(total_surface_area, 2),
        "window_to_floor_ratio_pct": round(window_to_floor, 2),
        "glazing_transmittance": round(args.glazing_transmittance, 2),
        "average_reflectance": round(args.average_reflectance, 2),
        "visible_sky_angle_deg": round(theta_deg, 1),
        "sky_angle_factor": round(theta_factor, 4),
        "daylight_factor_pct": round(daylight_factor, 2),
        "assessment": assessment,
        "kr_sunlight_note": (
            "BRE Daylight Factor (주광률) measures indoor diffuse daylight ratio. "
            "Korean legal sunlight compliance (건축법 제61조 정북방향 일조권 사선제한 및 공동주택 동지일 일조시간) "
            "requires separate solar geometry / 3D massing obstruction analysis."
        ),
    }


def format_output(result):
    """Format results for human-readable output."""
    lines = [
        "=== Daylight Factor Calculator ===",
        f"Room:     {result['room_width_m']:.2f}m W x {result['room_depth_m']:.2f}m D x {result['room_height_m']:.2f}m H",
        f"Window:   {result['window_width_m']:.2f}m W x {result['window_height_m']:.2f}m H (sill at {result['window_sill_height_m']:.2f}m)",
        "---------------------------------------",
        f"Window Area:             {result['window_area_m2']:.2f} m2",
        f"Floor Area:              {result['floor_area_m2']:.2f} m2",
        f"Total Room Surface Area: {result['total_surface_area_m2']:.2f} m2",
        f"Window-to-Floor Ratio:   {result['window_to_floor_ratio_pct']:.2f}%",
        f"Glazing Transmittance:   {result['glazing_transmittance']:.2f}",
        f"Average Reflectance:     {result['average_reflectance']:.2f}",
        f"Visible Sky Angle:       {result['visible_sky_angle_deg']:.1f} deg",
        "---------------------------------------",
        f"Average Daylight Factor: {result['daylight_factor_pct']:.2f}%",
        "",
        f"Assessment: {result['assessment']}",
        f"Note: {result['kr_sunlight_note']}",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Daylight Factor Calculator: estimate average daylight factor "
                    "for a side-lit room using BRE simplified formula."
    )
    parser.add_argument("--room-width", type=finite_float, required=True,
                        help="Room width in meters")
    parser.add_argument("--room-depth", type=finite_float, required=True,
                        help="Room depth (perpendicular to window wall) in meters")
    parser.add_argument("--room-height", type=finite_float, required=True,
                        help="Room height in meters")
    parser.add_argument("--window-width", type=finite_float, required=True,
                        help="Window width in meters")
    parser.add_argument("--window-height", type=finite_float, required=True,
                        help="Window height in meters")
    parser.add_argument("--window-sill-height", type=finite_float, required=True,
                        help="Window sill height from floor in meters")
    parser.add_argument("--glazing-transmittance", type=finite_float, default=0.65,
                        help="Glazing light transmittance, 0-1 (default: 0.65)")
    parser.add_argument("--average-reflectance", type=finite_float, default=0.50,
                        help="Average room surface reflectance, 0-1 (default: 0.50)")
    parser.add_argument("--obstruction-angle", type=finite_float, default=0.0,
                        help="External obstruction angle in degrees from window center (default: 0)")
    parser.add_argument("--sky-angle", type=finite_float, default=None,
                        help="Override visible sky angle in degrees directly")
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

