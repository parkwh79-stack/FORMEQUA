"""Execute original seven calculator examples and malformed inputs, no edits."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "Skills-Architects" / "skills" / "architect-calculator" / "scripts"
LAYERS = json.dumps([
    {"name": "Brick", "thickness_mm": 102, "conductivity": 0.77},
    {"name": "Cavity air gap", "thickness_mm": 50, "conductivity": 0.18},
    {"name": "Mineral wool", "thickness_mm": 100, "conductivity": 0.035},
    {"name": "Concrete block", "thickness_mm": 140, "conductivity": 1.13},
    {"name": "Plaster", "thickness_mm": 13, "conductivity": 0.16},
])
EXAMPLES = {
    "area": ["--site-area", "5000", "--far", "2.5", "--ntg-ratio", "0.82"],
    "uvalue": ["--layers", LAYERS],
    "daylight": ["--room-width", "4", "--room-depth", "6", "--room-height", "3", "--window-width", "2.5", "--window-height", "1.8", "--window-sill-height", "0.9"],
    "egress": ["--floor-area", "800", "--occupancy-type", "B", "--sprinklered", "--num-stories", "4"],
    "structural_load": ["--tributary-area", "36", "--num-floors", "8", "--occupancy-type", "office"],
    "energy": ["--floor-area", "500", "--envelope-area", "800", "--average-u-value", "0.35", "--heating-degree-days", "3000", "--cooling-degree-days", "500"],
    "cost": ["--gfa", "5000", "--building-type", "office", "--quality", "premium", "--region", "europe"],
}
ENV = os.environ.copy()
ENV["PYTHONIOENCODING"] = "utf-8"

def invoke(name, args):
    result = subprocess.run([sys.executable, str(SCRIPTS / (name + "_calculator.py")), *args],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, timeout=10)
    return {"args": args, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
            "traceback": "Traceback (most recent call last)" in result.stderr,
            "nonfinite_json_token": any(token in result.stdout for token in [": NaN", ": Infinity", ": -Infinity"])}

results = {"examples": {}, "malformed": {}}
for name, args in EXAMPLES.items():
    results["examples"][name] = {"text": invoke(name, args), "json": invoke(name, args + ["--json"])}
    primary = {"area": "--site-area", "uvalue": None, "daylight": "--room-width", "egress": "--floor-area", "structural_load": "--tributary-area", "energy": "--floor-area", "cost": "--gfa"}[name]
    for bad in ["nan", "inf", "-1"]:
        modified = list(args)
        if primary:
            modified[modified.index(primary) + 1] = bad
        else:
            modified = ["--layers", json.dumps([{"name": "invalid", "thickness_mm": float(bad) if bad != "-1" else -1, "conductivity": 0.035}])]
        results["malformed"][name + "/" + bad] = invoke(name, modified + ["--json"])
results["malformed"]["area/ambiguous-far"] = invoke("area", ["--site-area", "1000", "--far", "250", "--json"])
results["malformed"]["area/conflicting-far"] = invoke("area", ["--site-area", "1000", "--far", "2.5", "--far-pct", "300", "--json"])
results["malformed"]["uvalue/negative-surface-resistance"] = invoke("uvalue", EXAMPLES["uvalue"] + ["--rsi-internal", "-5", "--json"])
results["malformed"]["uvalue/string-thickness"] = invoke("uvalue", ["--layers", json.dumps([{"name":"x","thickness_mm":"100","conductivity":0.035}]), "--json"])
results["malformed"]["uvalue/window-taller-than-wall"] = invoke("uvalue", ["--facade", json.dumps({"width":6,"height":3,"wall_layers":json.loads(LAYERS),"openings":[{"type":"window","width":2,"height":4,"u_value":1.2}]}), "--json"])
results["malformed"]["daylight/excess-sky-angle"] = invoke("daylight", EXAMPLES["daylight"] + ["--sky-angle", "270", "--json"])
results["malformed"]["daylight/window-taller-than-wall"] = invoke("daylight", ["--room-width","4","--room-depth","6","--room-height","3","--window-width","2.5","--window-height","4","--window-sill-height","0", "--json"])
target = ROOT / ".backups" / "audit-20261021" / "calculator-cli-results.json"
target.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
for name, rows in results["examples"].items():
    print("EXAMPLE", name, "exit=", rows["text"]["exit_code"], "JSON exit=", rows["json"]["exit_code"])
    print(rows["text"]["stdout"].strip())
for name, row in results["malformed"].items():
    print("INPUT", name, "exit=", row["exit_code"], "traceback=", row["traceback"], "nonfinite=", row["nonfinite_json_token"], "stderr=", row["stderr"].splitlines()[-1:] or "none")
print("EVIDENCE", target)
