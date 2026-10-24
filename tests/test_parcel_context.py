"""Bounded real GIS context contracts; upstream I/O is mocked, no API key needed."""
import copy
import json
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import parcel_service as service

PNU = "1168010100100010000"
OTHER = "1168010100100020000"


def polygon(x=127, y=37.5):
    return {"type": "Polygon", "coordinates": [[[x, y], [x+.001, y], [x+.001, y+.001], [x, y+.001], [x, y]]]}


def feature(props, geometry=None):
    return {"type": "Feature", "properties": props, "geometry": copy.deepcopy(geometry or polygon())}


def parcel(pnu=PNU):
    return {"version": 1, "source": "vworld", "features": [feature({"pnu": pnu, "source": "vworld"})]}


def response(features, *, total=None, pages=1, current=1):
    return {"response": {"status": "OK", "record": {"total": str(len(features) if total is None else total)},
        "page": {"total": str(pages), "current": str(current)},
        "result": {"featureCollection": {"type": "FeatureCollection", "features": features}}}}


LINE = {"type": "MultiLineString", "coordinates": [[[126.999, 37.5005], [127.002, 37.5005]]]}


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"VWORLD_API_KEY": "PRIVATE_TEST_KEY"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.boundary = patch.object(service, "fetch_parcel", side_effect=lambda p: parcel(p))
        self.boundary_mock = self.boundary.start()
        self.addCleanup(self.boundary.stop)

    def fetch(self, layers=None, failure=None, unknown_metadata=None):
        layers = layers or {}
        def mock(endpoint, params, deadline=None):
            self.assertEqual(endpoint, "vworld_data")
            self.assertEqual(params["crs"], "EPSG:4326")
            self.assertEqual(params["geometry"], "true")
            self.assertEqual(params["attribute"], "true")
            self.assertEqual(params["size"], service._CONTEXT_PAGE_SIZE)
            self.assertRegex(params["geomFilter"], r"^BOX\([0-9.,]+\)$")
            layer = params["data"]
            if layer == failure:
                raise RuntimeError("https://bad.invalid/?key=PRIVATE_TEST_KEY")
            result = response(layers.get(layer, []))
            if layer == unknown_metadata:
                result["response"].pop("page")
            return result
        with patch.object(service, "_get_json", side_effect=mock) as network:
            result = service.fetch_parcel_context([PNU, OTHER])
        self.assertEqual(network.call_count, 4)
        return result

    def test_actual_geometries_and_fixed_provenance_no_inferred_road_width(self):
        hole = [[127.0002,37.5002],[127.0003,37.5002],[127.0003,37.5003],[127.0002,37.5002]]
        geom = polygon()
        geom["coordinates"].append(hole)
        source_line = copy.deepcopy(LINE)
        result = self.fetch({
            "LP_PA_CBND_BUBUN": [feature({"pnu": PNU, "addr": "테스트동 1", "jibun": "1도", "secret": "PRIVATE_TEST_KEY"}, geom)],
            "LT_L_SPRD": [feature({"rn": "테스트길", "road_bt": "10.0", "key": "PRIVATE_TEST_KEY"}, source_line)],
            "LT_L_N3A0020000": [feature({"rdnm": "중심선", "rvwd": "9.5", "rdln": "2", "far": 900}, LINE)],
            "LT_C_UPISUQ151": [feature({"dgm_nm": "소로2류", "present_sn": "P1", "ntfc_sn": "N1", "exc_nam": "기타"})]})
        self.assertEqual(result["crs"], "EPSG:4326")
        self.assertEqual(result["pnus"], [PNU, OTHER])
        self.assertEqual(result["parcels"]["features"][0]["geometry"], geom, "holes and original coordinates are preserved")
        self.assertTrue(result["parcels"]["features"][0]["properties"]["selected"])
        self.assertEqual(result["roads"]["features"][0]["geometry"], source_line)
        for road in result["roads"]["features"]:
            self.assertIsNone(road["properties"]["widthM"])
            self.assertFalse(road["properties"]["widthVerified"])
            self.assertFalse(road["properties"]["physicalBoundaryVerified"])
        self.assertEqual(result["roads"]["features"][1]["properties"]["attributes"]["rvwd"], "9.5")
        plan = result["plannedRoads"]["features"][0]
        self.assertTrue(plan["properties"]["planned"])
        self.assertEqual(plan["properties"]["noticeId"], "N1")
        self.assertTrue(all(layer["status"] == "available" for layer in result["layers"]))
        self.assertTrue(all(layer["source"]["url"] == "https://api.vworld.kr/req/data" for layer in result["layers"]))
        self.assertNotIn("PRIVATE_TEST_KEY", json.dumps(result))
        self.assertNotIn("landCategoryVerified", result["parcels"]["features"][0]["properties"])

    def test_missing_layer_is_not_empty_and_never_replaced_with_mock_geometry(self):
        result = self.fetch(failure="LT_L_SPRD")
        statuses = {item["id"]: item for item in result["layers"]}
        self.assertEqual(statuses["LT_L_SPRD"]["status"], "unavailable")
        self.assertEqual(statuses["LP_PA_CBND_BUBUN"]["status"], "empty")
        self.assertEqual(result["roads"]["features"], [])
        self.assertEqual(result["parcels"]["features"], [])
        self.assertNotIn("PRIVATE_TEST_KEY", json.dumps(result))
        self.assertNotIn("bad.invalid", json.dumps(result))

    def test_malformed_or_out_of_extent_coordinates_are_skipped_and_partial(self):
        wrong = copy.deepcopy(LINE)
        wrong["coordinates"][0][0][0] = float("nan")
        bool_coord = {"type":"LineString", "coordinates":[[True,37.5],[127,37.5]]}
        degenerate = {"type":"LineString", "coordinates":[[127,37.5],[127,37.5]]}
        distant = {"type":"LineString", "coordinates":[[129,37.5],[129.1,37.5]]}
        result = self.fetch({"LT_L_SPRD": [feature({"rn":"길"}, g) for g in (LINE, wrong, bool_coord, degenerate, distant)]})
        layer = next(v for v in result["layers"] if v["id"] == "LT_L_SPRD")
        self.assertEqual(layer["status"], "partial")
        self.assertEqual(layer["featureCount"], 1)
        self.assertEqual(len(result["roads"]["features"]), 1)
        json.dumps(result, allow_nan=False)

    def test_invalid_cadastral_pnu_is_not_assigned_to_selected_parcel(self):
        result = self.fetch({"LP_PA_CBND_BUBUN": [feature({"pnu":"bad"})]})
        self.assertEqual(result["parcels"]["features"], [])
        self.assertEqual(result["layers"][0]["status"], "partial")

    def test_absent_pagination_metadata_does_not_claim_complete(self):
        result = self.fetch(unknown_metadata="LT_L_SPRD")
        self.assertEqual(result["layers"][1]["status"], "partial")

    def test_bbox_uses_all_selected_parcels_and_bounded_margin(self):
        second = parcel(OTHER)
        second["features"][0]["geometry"] = polygon(127.002)
        with patch.object(service, "fetch_parcel", side_effect=lambda p: parcel(p) if p == PNU else second), \
                patch.object(service, "_context_features", return_value=([], True, 0)):
            result = service.fetch_parcel_context([PNU, OTHER], "120")
        self.assertLess(result["bbox"][0], 127)
        self.assertGreater(result["bbox"][2], 127.003)
        self.assertEqual(len(result["selectedParcels"]["features"]), 2)
        self.assertAlmostEqual((result["bbox"][3]-37.501)*111320, 120, places=5)

    def test_extreme_selected_extent_rejected_before_context_network(self):
        far = parcel(OTHER)
        far["features"][0]["geometry"] = polygon(128)
        with patch.object(service, "fetch_parcel", side_effect=[parcel(), far]), patch.object(service, "_context_features") as network:
            with self.assertRaises(service.ParcelServiceError) as caught:
                service.fetch_parcel_context([PNU, OTHER])
        self.assertEqual(caught.exception.code, "CONTEXT_EXTENT_TOO_LARGE")
        network.assert_not_called()

    def test_duplicate_pnu_only_fetches_once(self):
        with patch.object(service, "_context_features", return_value=([], True, 0)):
            result = service.fetch_parcel_context([PNU, PNU])
        self.boundary_mock.assert_called_once_with(PNU)
        self.assertEqual(result["pnus"], [PNU])


class ContextPageTests(unittest.TestCase):
    def test_two_pages_are_fetched_and_source_rows_deduplicated(self):
        rows = [feature({"pnu": PNU}) for _ in range(service._CONTEXT_PAGE_SIZE)]
        with patch.object(service, "_vworld", side_effect=[
                response(rows, total=301, pages=2)["response"],
                response([feature({"pnu": OTHER})], total=301, pages=2, current=2)["response"]]) as network:
            raw, complete, total = service._context_features("LP_PA_CBND_BUBUN", (126.99,37.49,127.01,37.51), time.monotonic()+10)
        self.assertTrue(complete)
        self.assertEqual(total, 301)
        self.assertEqual([call.args[1]["page"] for call in network.call_args_list], [1, 2])
        canonical, skipped = service._canonical_context(raw, "LP_PA_CBND_BUBUN", "cadastral", [PNU], (126.99,37.49,127.01,37.51))
        self.assertEqual(len(canonical), 2)
        self.assertEqual(skipped, 0)

    def test_feature_cap_has_partial_status_and_no_unbounded_pagination(self):
        rows = [feature({"rn":"길"}, LINE)] * service._CONTEXT_PAGE_SIZE
        with patch.object(service, "_vworld", side_effect=[
                response(rows, total=900, pages=3, current=1)["response"],
                response(rows, total=900, pages=3, current=2)["response"]]) as network:
            raw, complete, total = service._context_features("LT_L_SPRD", (126.99,37.49,127.01,37.51), time.monotonic()+10)
        self.assertEqual(len(raw), 600)
        self.assertFalse(complete)
        self.assertEqual(total, 900)
        self.assertEqual(network.call_count, 2)

    def test_coordinate_cap_retains_only_validated_features_and_reports_skips(self):
        with patch.object(service, "_MAX_CONTEXT_COORDINATES", 3):
            canonical, skipped = service._canonical_context(
                [feature({"rn":"첫 길"}, LINE), feature({"rn":"두 번째 길"}, LINE)],
                "LT_L_SPRD", "road-centerline", [PNU], (126.99,37.49,127.01,37.51))
        self.assertEqual(len(canonical), 1)
        self.assertEqual(skipped, 1)

    def test_invalid_pagination_does_not_claim_complete(self):
        for bad in (True, 1.0, "1.0", "-1", "999999999999"):
            payload = response([feature({"rn":"길"}, LINE)])["response"]
            payload["page"]["total"] = bad
            with patch.object(service, "_vworld", return_value=payload):
                _raw, complete, _total = service._context_features("LT_L_SPRD", (126.99,37.49,127.01,37.51), time.monotonic()+10)
            self.assertFalse(complete)

    def test_invalid_layer_and_inputs_do_not_call_network(self):
        with patch.object(service, "_vworld") as network:
            with self.assertRaises(service.ParcelServiceError):
                service._context_features("https://untrusted.invalid/", (127,37.5,127.1,37.6), time.monotonic()+10)
            network.assert_not_called()
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "fetch_parcel") as boundary:
            for pnus, radius in (([],120), ([PNU]*6,120), (["bad"],120), (PNU,120), ([PNU],19), ([PNU],301), ([PNU],True), ([PNU],float("nan"))):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel_context(pnus, radius)
                self.assertEqual(caught.exception.status, 400)
            with self.assertRaises(service.ParcelServiceError) as caught:
                service.fetch_parcel_context([PNU])
            self.assertEqual(caught.exception.code, "PROVIDER_NOT_CONFIGURED")
            boundary.assert_not_called()


if __name__ == "__main__":
    unittest.main()
