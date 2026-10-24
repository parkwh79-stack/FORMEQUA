"""CLI regressions for the seven original Skills Architects calculators.

These tests verify examples and input contracts, not Korean legal approval or
the engineering suitability of the unchanged preliminary formulas.
"""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "runtime" / "Skills-Architects" / "skills" / "architect-calculator" / "scripts"
LAYERS = [{"name":"Brick","thickness_mm":102,"conductivity":0.77},
          {"name":"Cavity air gap","thickness_mm":50,"conductivity":0.18},
          {"name":"Mineral wool","thickness_mm":100,"conductivity":0.035},
          {"name":"Concrete block","thickness_mm":140,"conductivity":1.13},
          {"name":"Plaster","thickness_mm":13,"conductivity":0.16}]
EXAMPLES = {
    "area":["--site-area","5000","--far","2.5","--ntg-ratio","0.82"],
    "uvalue":["--layers",json.dumps(LAYERS)],
    "daylight":["--room-width","4","--room-depth","6","--room-height","3","--window-width","2.5","--window-height","1.8","--window-sill-height","0.9"],
    "egress":["--floor-area","800","--occupancy-type","B","--sprinklered","--num-stories","4"],
    "structural_load":["--tributary-area","36","--num-floors","8","--occupancy-type","office"],
    "energy":["--floor-area","500","--envelope-area","800","--average-u-value","0.35","--heating-degree-days","3000","--cooling-degree-days","500"],
    "cost":["--gfa","5000","--building-type","office","--quality","premium","--region","europe"],
}
ENV = {**os.environ,"PYTHONIOENCODING":"utf-8"}


def execute(name, args, output_json=True):
    return subprocess.run([sys.executable,str(SCRIPTS/(name+"_calculator.py")),*args,*( ["--json"] if output_json else [])],
                          capture_output=True,text=True,encoding="utf-8",errors="replace",env=ENV,timeout=8)


class CalculatorInputs(unittest.TestCase):
    def reject(self, name, args, output_json=True):
        result = execute(name,args,output_json)
        self.assertNotEqual(result.returncode,0,(name,args,result.stdout))
        self.assertIn("error",result.stderr.lower(),(name,args,result.stderr))
        self.assertNotIn("Traceback",result.stderr,(name,args,result.stderr))
        for token in [": NaN",": Infinity",": -Infinity"]:
            self.assertNotIn(token,result.stdout)

    def test_seven_documented_examples_reproduce(self):
        expected={"area":("far_countable_gfa_m2",12500),"uvalue":("u_value",0.2745),
                  "daylight":("daylight_factor_pct",2.08),"egress":("occupant_load",87),
                  "structural_load":("preliminary_column_mm",400),"energy":("eui_kWh_m2_yr",86.31),
                  "cost":("total_development_cost_usd",20160000)}
        for name,args in EXAMPLES.items():
            with self.subTest(calculator=name):
                result=execute(name,args)
                self.assertEqual(result.returncode,0,result.stderr)
                data=json.loads(result.stdout,parse_constant=lambda token: self.fail("Non-standard JSON: "+token))
                key,value=expected[name]
                self.assertEqual(data[key],value)
                if name=="area":self.assertIsNone(data["site_coverage_pct"])
                if name=="structural_load":self.assertEqual(data["ag_required_mm2"],140120)

    def test_every_float_cli_flag_rejects_nonfinite(self):
        for name,args in EXAMPLES.items():
            tree=ast.parse((SCRIPTS/(name+"_calculator.py")).read_text(encoding="utf-8"))
            flags=[node.args[0].value for node in ast.walk(tree)
                   if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=="add_argument"
                   and any(kw.arg=="type" and isinstance(kw.value,ast.Name) and kw.value.id in ("float","finite_float") for kw in node.keywords)]
            for flag in flags:
                for value in ["nan","inf","-inf"]:
                    with self.subTest(calculator=name,flag=flag,value=value):self.reject(name,args+[flag,value])

    def test_negative_required_areas_are_clear_errors(self):
        for name,flag in {"area":"--site-area","daylight":"--room-width","egress":"--floor-area",
                          "structural_load":"--tributary-area","energy":"--floor-area","cost":"--gfa"}.items():
            with self.subTest(calculator=name):self.reject(name,EXAMPLES[name]+[flag,"-1"])

    def test_uvalue_json_layers_types_and_finiteness(self):
        invalid=[None,{},[],[1],[None],["layer"], [{"name":"x","thickness_mm":"100","conductivity":0.03}],
                 [{"name":"x","thickness_mm":True,"conductivity":0.03}],
                 [{"name":"x","thickness_mm":100,"conductivity":None}],
                 [{"name":"x","thickness_mm":float("nan"),"conductivity":0.03}],
                 [{"name":"x","thickness_mm":100,"conductivity":float("inf")}]]
        for value in invalid:
            with self.subTest(layers=value):self.reject("uvalue",["--layers",json.dumps(value)])

    def test_uvalue_facade_nested_types_and_counts(self):
        valid={"width":6,"height":3,"wall_layers":LAYERS,"openings":[{"type":"window","width":1,"height":1.5,"u_value":1.2}]}
        invalid=[[],{**valid,"width":"6"},{**valid,"height":True},{**valid,"openings":{}},
                 {**valid,"openings":[None]},{**valid,"thermal_bridges":[[]]},
                 {**valid,"thermal_bridges":[{"psi":"0.2","length":3}]}]
        for field,value in [("width",float("inf")),("height","1.5"),("sill",float("nan")),("u_value",True),
                            ("psi",float("inf")),("count",-1),("count",1.5),("count",True),("type","unknown")]:
            invalid.append({**valid,"openings":[{**valid["openings"][0],field:value}]})
        for value in invalid:
            with self.subTest(facade=value):self.reject("uvalue",["--facade",json.dumps(value)])

    def test_windows_larger_than_wall_are_rejected(self):
        self.reject("daylight",EXAMPLES["daylight"]+["--window-height","4"])
        self.reject("uvalue",["--facade",json.dumps({"width":6,"height":3,"wall_layers":LAYERS,
                    "openings":[{"type":"window","width":2,"height":4,"u_value":1.2}]})])

    def test_daylight_angles_are_within_hemisphere(self):
        for flag in ["--sky-angle","--obstruction-angle"]:
            for value in ["-1","91","270"]:
                with self.subTest(flag=flag,value=value):self.reject("daylight",EXAMPLES["daylight"]+[flag,value])
            for value in ["0","90"]:
                with self.subTest(flag=flag,boundary=value):self.assertEqual(execute("daylight",EXAMPLES["daylight"]+[flag,value]).returncode,0)

    def test_arithmetic_overflow_is_not_nonstandard_json_or_traceback(self):
        for name,flag in {"area":"--site-area","daylight":"--room-width","egress":"--floor-area",
                          "structural_load":"--tributary-area","energy":"--floor-area","cost":"--gfa"}.items():
            with self.subTest(calculator=name):
                args=EXAMPLES[name]+[flag,"1e308"]
                result=execute(name,args)
                if result.returncode:
                    self.assertIn("error",result.stderr.lower())
                    self.assertNotIn("Traceback",result.stderr)
                else:
                    # Some formulas still yield finite numbers at this scale.
                    # Such a result need not be rejected to satisfy JSON safety.
                    json.loads(result.stdout,parse_constant=lambda token:self.fail("Non-finite JSON: "+token))
        self.reject("uvalue",["--layers",json.dumps([{"name":"large","thickness_mm":1e308,"conductivity":1e-308}])])


if __name__=="__main__":unittest.main()
