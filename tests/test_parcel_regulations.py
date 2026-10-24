"""Official layer/field contracts with mocked HTTP and the actual polygon engine."""
import copy
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import parcel_service as service

PNU = "1168010100100010000"


def rectangle(x0, x1, y0=37.5, y1=37.501):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


PARCEL = {"version": 1, "source": "vworld", "features": [{"type": "Feature",
    "geometry": rectangle(127, 127.001), "properties": {"pnu": PNU, "source": "vworld"}}]}


def zone(name, geometry, code=None):
    props = {"uname": name, "farPct": 999, "bcrPct": 99, "heightM": 300, "dnum": "irrelevant"}
    if code:
        props["ucode"] = code
    return {"type": "Feature", "properties": props, "geometry": copy.deepcopy(geometry)}


def district(geometry):
    return {"type": "Feature", "properties": {"dgm_nm": "테스트 지구단위계획", "present_sn": "PRESENT-1",
        "ntfc_sn": "NOTICE-2026-1", "lcl_nam": "분류명을 계획 이름으로 사용하지 않음", "url": "https://untrusted.example/"},
        "geometry": copy.deepcopy(geometry)}


def response(features, total=None):
    return {"response": {"status": "OK", "record": {"total": str(len(features) if total is None else total)},
        "page": {"total": "1"}, "result": {"featureCollection": {"type": "FeatureCollection", "features": features}}}}


@unittest.skipUnless(shutil.which("node"), "the shared application geometry engine requires Node.js")
class ParcelRegulationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"VWORLD_API_KEY": "DUMMY_PRIVATE_KEY",
            "PATH": os.environ.get("PATH", ""), "SystemRoot": os.environ.get("SystemRoot", "")}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.boundary = patch.object(service, "fetch_parcel", return_value=copy.deepcopy(PARCEL))
        self.boundary.start()
        self.addCleanup(self.boundary.stop)

    def fetch(self, layers, *, incomplete=None, failure=None):
        def mocked(endpoint, params, deadline=None):
            self.assertEqual(endpoint, "vworld_data")
            self.assertEqual(params["crs"], "EPSG:4326")
            self.assertEqual(params["geometry"], "true")
            self.assertEqual(params["attribute"], "true")
            self.assertIn("geomFilter", params)
            layer = params["data"]
            if layer == failure:
                raise service.ParcelServiceError("UPSTREAM_TIMEOUT", "safe message", 504)
            features = layers.get(layer, [])
            return response(features, total=2000 if layer == incomplete else None)
        with patch.object(service, "_get_json", side_effect=mocked) as upstream:
            result = service.fetch_parcel_regulations(PNU)
        self.assertEqual(upstream.call_count, 5, "all four zoning layers and the district plan layer are checked")
        return result

    def test_single_official_zone_complete_and_plan_limits_remain_unknown(self):
        result = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001))]})
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["pnu"], PNU)
        self.assertEqual(result["zones"][0]["name"], "일반상업지역")
        self.assertNotIn("code", result["zones"][0], "an absent official code is not inferred from the zone name")
        self.assertAlmostEqual(result["zones"][0]["intersectionAreaSqm"], 9809.2951, places=3)
        self.assertEqual(result["zones"][0]["coveragePct"], 100)
        self.assertEqual(result["limits"], {"farPct": None, "bcrPct": None, "heightM": None})
        self.assertEqual(len(result["sources"]), 5)
        self.assertTrue(all(item["url"] == "https://api.vworld.kr/req/data" for item in result["sources"]))
        self.assertNotIn("DUMMY_PRIVATE_KEY", json.dumps(result))

    def test_distinct_zones_split_actual_parcel_and_plan_metadata_is_exact(self):
        result = self.fetch({"LT_C_UQ111": [zone("제3종일반주거지역", rectangle(127, 127.0005), "UQA123"),
            zone("일반상업지역", rectangle(127.0005, 127.001), "UQA220")],
            "LT_C_UPISUQ161": [district(rectangle(127.00025, 127.00075))]})
        self.assertEqual(result["status"], "verified")
        self.assertEqual(len(result["zones"]), 2)
        self.assertAlmostEqual(result["zones"][0]["intersectionAreaSqm"], result["zones"][1]["intersectionAreaSqm"], places=3)
        self.assertEqual([item["coveragePct"] for item in result["zones"]], [50, 50])
        self.assertTrue(any("여러 용도지역" in value for value in result["warnings"]))
        plan = result["districtPlans"][0]
        self.assertEqual(plan["name"], "테스트 지구단위계획")
        self.assertEqual(plan["code"], "PRESENT-1")
        self.assertEqual(plan["noticeId"], "NOTICE-2026-1")
        self.assertNotIn("url", plan, "a field outside the confirmed official schema is not promoted to a source URL")
        self.assertAlmostEqual(plan["intersectionAreaSqm"], 4904.6475, places=3)
        self.assertEqual(result["limits"]["farPct"], None)

    def test_neighboring_and_boundary_touching_candidates_are_excluded(self):
        result = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001)),
            zone("준주거지역", rectangle(127.001, 127.002)),
            zone("근린상업지역", rectangle(127.002, 127.003))]})
        self.assertEqual([value["name"] for value in result["zones"]], ["일반상업지역"])
        self.assertEqual(result["status"], "verified")

    def test_duplicate_zone_features_are_unioned_before_area_measurement(self):
        same = zone("일반상업지역", rectangle(127, 127.001))
        result = self.fetch({"LT_C_UQ111": [same, copy.deepcopy(same)]})
        self.assertEqual(len(result["zones"]), 1)
        self.assertAlmostEqual(result["zones"][0]["intersectionAreaSqm"], 9809.2951, places=3)
        self.assertEqual(result["status"], "verified")

    def test_partial_coverage_or_truncation_or_failed_layer_is_not_verified(self):
        partial = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.0005))]})
        self.assertEqual(partial["status"], "partial")
        self.assertTrue(any("필지 전체" in warning for warning in partial["warnings"]))
        full = {"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001))]}
        self.assertEqual(self.fetch(full, incomplete="LT_C_UQ111")["status"], "partial")
        failed = self.fetch(full, failure="LT_C_UPISUQ161")
        self.assertEqual(failed["status"], "partial")
        self.assertTrue(any("결과 없음으로 확정하지" in warning for warning in failed["warnings"]))

    def test_distinct_overlapping_zone_designations_warn_without_blending_limits(self):
        result = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001)),
            zone("준주거지역", rectangle(127, 127.001))]})
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("중복" in warning for warning in result["warnings"]))
        self.assertEqual(result["limits"], {"farPct": None, "bcrPct": None, "heightM": None})

    def test_missing_name_is_not_replaced_by_layer_title(self):
        unknown = zone("", rectangle(127, 127.001))
        result = self.fetch({"LT_C_UQ111": [unknown]})
        self.assertEqual(result["status"], "unverified")
        self.assertEqual(result["zones"], [])
        self.assertTrue(any("명칭을 추정하지" in warning for warning in result["warnings"]))

    def test_missing_intersection_engine_does_not_label_bbox_neighbors_as_members(self):
        with patch.object(service, "_intersection_areas", side_effect=service.ParcelServiceError("INTERSECTION_UNAVAILABLE", "safe", 503)):
            result = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001))]})
        self.assertEqual(result["status"], "unverified")
        self.assertEqual(result["zones"], [])
        self.assertTrue(any("교차면적을 계산하지" in warning for warning in result["warnings"]))

    def test_polygon_holes_exclude_plan_coverage(self):
        outer = rectangle(126.999, 127.002, 37.499, 37.502)["coordinates"][0]
        hole = rectangle(127, 127.001)["coordinates"][0]
        result = self.fetch({"LT_C_UQ111": [zone("일반상업지역", rectangle(127, 127.001))],
            "LT_C_UPISUQ161": [district({"type": "Polygon", "coordinates": [outer, hole]})]})
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["districtPlans"], [], "a parcel inside a plan polygon's hole is not inside the plan")


class RegulationInputTests(unittest.TestCase):
    def test_missing_key_or_bad_pnu_never_fetches_boundary(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "fetch_parcel") as boundary:
            for pnu, expected in ((PNU, 503), ("bad", 400)):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel_regulations(pnu)
                self.assertEqual(caught.exception.status, expected)
            boundary.assert_not_called()


if __name__ == "__main__":
    unittest.main()
