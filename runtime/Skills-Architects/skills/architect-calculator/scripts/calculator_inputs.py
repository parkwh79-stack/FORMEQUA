"""Input/output guards shared by the seven calculator command-line programs.

Calculation functions keep their existing formulas. Python callers must first
run the calculator's validate_inputs/validate_layers/validate_facade function;
CLI parsing and these guards do not establish statutory compliance.
"""
import argparse
import json
import math
import sys


def is_finite_number(value):
    """JSON booleans and numeric-looking strings are not measurements."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def finite_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise argparse.ArgumentTypeError("must be a finite number") from exc
    if not math.isfinite(number):
        raise argparse.ArgumentTypeError("must be a finite number; NaN and Infinity are not accepted")
    return number


def strict_json_loads(value):
    def reject_constant(token):
        raise ValueError(f"JSON measurement must be finite; {token} is not accepted")
    return json.loads(value, parse_constant=reject_constant)


def validate_measurements(args, names, optional=()):
    """Support Python callers using the documented validate-before-calculate contract."""
    errors = []
    for name in names:
        value = getattr(args, name, None)
        if value is None and name in optional:
            continue
        if not is_finite_number(value):
            errors.append(f"{name.replace('_', '-')}: must be a finite number")
    return errors


def ensure_finite_output(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Calculation produced a non-finite value; check input magnitude and units")
    if isinstance(value, dict):
        for item in value.values():
            ensure_finite_output(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            ensure_finite_output(item)


def safe_json_dumps(value, **kwargs):
    ensure_finite_output(value)
    return json.dumps(value, allow_nan=False, **kwargs)


def run_cli(main):
    """Return clear CLI errors for invalid measurements or arithmetic overflow."""
    try:
        main()
    except (ValueError, OverflowError, TypeError, ZeroDivisionError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
