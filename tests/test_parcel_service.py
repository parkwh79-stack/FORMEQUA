"""Mock-only provider tests: never require or contact an approved API key."""
import copy
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib import error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import parcel_service as service

PNU = "1168010100100010000"
OTHER_PNU = "1168010100100020000"
POLYGON = {"type": "Polygon", "coordinates": [[[127.0, 37.5], [127.001, 37.5], [127.001, 37.501], [127.0, 37.5]]]}


def feature(pnu=PNU, geometry=None):
    return {"type": "Feature", "geometry": copy.deepcopy(geometry or POLYGON),
        "properties": {"pnu": pnu, "addr": "서울특별시 강남구 역삼동 1", "far": 999, "upstream_secret": "MUST_NOT_COPY"}}


def data_response(features):
    return {"response": {"status": "OK", "result": {"featureCollection": {"type": "FeatureCollection", "features": features}}}}


def search_response(items):
    return {"response": {"status": "OK", "record": {"total": str(len(items))}, "result": {"items": items}}}


def juso_response(items, total=None):
    return {"results": {"common": {"errorCode": "0", "totalCount": str(total if total is not None else len(items))}, "juso": items}}


def address_item(**extra):
    return {"admCd": "1168010100", "mtYn": "0", "lnbrMnnm": "1", "lnbrSlno": "0",
        "roadAddr": "서울특별시 강남구 테헤란로 1", "jibunAddr": "서울특별시 강남구 역삼동 1", **extra}


class FakeResponse:
    def __init__(self, raw=b'{}', headers=None):
        self.raw, self.headers = raw, headers or {}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, size):
        return self.raw[:size]


class ParcelServiceTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_no_keys_and_no_secret_status(self):
        self.assertFalse(service.status()["addressSearchReady"])
        self.assertFalse(service.status()["boundaryReady"])
        for invoke in (lambda: service.search_addresses("서울 역삼동 1"), lambda: service.fetch_parcel(PNU)):
            with self.assertRaises(service.ParcelServiceError) as caught:
                invoke()
            self.assertEqual(caught.exception.status, 503)
        os.environ["JUSO_API_KEY"] = "DUMMY_JUSO_SECRET"
        self.assertTrue(service.status()["addressSearchReady"])
        self.assertNotIn("DUMMY_JUSO_SECRET", json.dumps(service.status()))
        self.assertEqual(service.status()["regulations"]["status"], "unverified")

    def test_bad_inputs_never_call_upstream(self):
        with patch.object(service, "_get_json") as upstream:
            for value in ("", "a", "x" * 201, "주소\n주입", None, 123):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.search_addresses(value)
                self.assertEqual(caught.exception.status, 400)
            for value in ("123", 1168010100100010000, "1" * 18 + "A", "1" * 19 + "/"):
                with self.assertRaises(service.ParcelServiceError):
                    service.fetch_parcel(value)
            upstream.assert_not_called()

    def test_juso_derives_exact_main_sub_and_mountain_pnu(self):
        os.environ["JUSO_API_KEY"] = "DUMMY_JUSO_SECRET"
        with patch.object(service, "_get_json", return_value=juso_response([
            address_item(), address_item(mtYn="1", lnbrMnnm=23, lnbrSlno=7, relJibun="역삼동 산23-8"), address_item()
        ], total=23)) as upstream:
            result = service.search_addresses("  서울 역삼동 1  ")
        self.assertEqual([item["pnu"] for item in result["candidates"]], [PNU, "1168010100200230007"])
        self.assertEqual(result["query"], "서울 역삼동 1")
        self.assertEqual(result["candidates"][1]["relatedJibun"], "역삼동 산23-8")
        self.assertTrue(result["truncated"])
        self.assertTrue(any("대표 지번" in note for note in result["notes"]))
        endpoint, params, _deadline = upstream.call_args.args
        self.assertEqual(endpoint, "juso")
        self.assertEqual(params["countPerPage"], 10)
        self.assertEqual(params["resultType"], "json")
        self.assertNotIn("DUMMY_JUSO_SECRET", json.dumps(result))

    def test_juso_never_uses_building_management_number_as_pnu(self):
        os.environ["JUSO_API_KEY"] = "dummy"
        invalid = address_item(admCd="11680101", buldMgtSn=PNU)
        with patch.object(service, "_get_json", return_value=juso_response([invalid])):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service.search_addresses("서울 역삼동")
        self.assertEqual(caught.exception.code, "ADDRESS_PNU_UNRESOLVED")
        for changed in ({"lnbrMnnm": "10000"}, {"lnbrSlno": "-1"}, {"mtYn": "2"}, {"lnbrMnnm": 0}):
            self.assertIsNone(service._juso_pnu(address_item(**changed)))

    def test_vworld_direct_pnu_and_road_category_fallback(self):
        os.environ["VWORLD_API_KEY"] = "DUMMY_VWORLD_SECRET"
        item = {"id": PNU, "point": {"x": "127.001", "y": "37.501"},
            "address": {"road": "도로명 1", "parcel": "역삼동 1"}}
        with patch.object(service, "_get_json", side_effect=[{"response": {"status": "NOT_FOUND"}}, search_response([item])]) as upstream:
            result = service.search_addresses("역삼동 1")
        self.assertEqual(result["candidates"][0]["pnu"], PNU)
        self.assertEqual(result["candidates"][0]["address"], "역삼동 1", "the representative display remains the cadastral address")
        self.assertEqual(result["candidates"][0]["pnuMethod"], "address-id")
        self.assertEqual(upstream.call_args_list[0].args[1]["category"], "parcel")
        self.assertEqual(upstream.call_args_list[1].args[1]["category"], "road")
        self.assertEqual(upstream.call_count, 2)
        self.assertNotIn("DUMMY_VWORLD_SECRET", json.dumps(result))

    def test_vworld_non_pnu_id_resolves_point_against_cadastral_layer(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        item = {"id": "BUILDING-XYZ", "point": {"x": "127.001", "y": "37.501"}, "address": {"parcel": "역삼동 1"}}
        with patch.object(service, "_get_json", side_effect=[search_response([item]), data_response([feature(), feature(OTHER_PNU)])]) as upstream:
            result = service.search_addresses("역삼동 1")
        self.assertEqual([item["pnu"] for item in result["candidates"]], [PNU, OTHER_PNU])
        self.assertEqual(upstream.call_args_list[0].args[1]["category"], "parcel")
        self.assertEqual(upstream.call_count, 2, "resolved cadastral candidates do not trigger a second road-address search")
        self.assertTrue(all("복수" in item["note"] for item in result["candidates"]))
        request_params = upstream.call_args_list[1].args[1]
        self.assertEqual(request_params["data"], "LP_PA_CBND_BUBUN")
        self.assertEqual(request_params["geomFilter"], "POINT(127.001000000 37.501000000)")
        self.assertEqual(request_params["crs"], "EPSG:4326")
        self.assertNotIn("attrFilter", request_params)

    def test_fetch_boundary_is_canonical_and_drops_unverified_regulations(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        payload = data_response([feature()])
        original = copy.deepcopy(payload)
        with patch.object(service, "_get_json", return_value=payload) as upstream:
            result = service.fetch_parcel(PNU)
        self.assertEqual(payload, original)
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["source"], "vworld")
        self.assertEqual(result["features"][0]["geometry"], POLYGON)
        self.assertEqual(result["features"][0]["properties"], {"pnu": PNU, "source": "vworld", "address": "서울특별시 강남구 역삼동 1"})
        self.assertNotIn("MUST_NOT_COPY", json.dumps(result))
        self.assertNotIn("far", json.dumps(result))
        params = upstream.call_args.args[1]
        self.assertEqual(params["attrFilter"], f"pnu:=:{PNU}")
        self.assertEqual(params["geometry"], "true")

    def test_fetch_rejects_mismatched_pnu_and_unavailable_boundary(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        for payload, code, status in [(data_response([feature(OTHER_PNU)]), "PNU_MISMATCH", 502),
                ({"response": {"status": "NOT_FOUND"}}, "PARCEL_NOT_FOUND", 404),
                ({"response": {"status": "OK", "result": []}}, "UPSTREAM_FORMAT", 502)]:
            with patch.object(service, "_get_json", return_value=payload):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel(PNU)
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(caught.exception.status, status)

    def test_fetch_rejects_incomplete_or_contradictory_boundary_pages(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        for record, page in [({"total": "11"}, {"total": "2", "current": "1"}),
                ({"total": "2"}, {"total": "1"}), ({"total": "0"}, {"total": "1"}),
                ({"current": "2"}, {"total": "1"}), ({"total": "1"}, {"current": "2"}),
                ({"total": "1"}, {"total": "0"})]:
            payload = data_response([feature()])
            payload["response"].update({"record": record, "page": page})
            with patch.object(service, "_get_json", return_value=payload):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel(PNU)
            self.assertEqual(caught.exception.code, "PARCEL_BOUNDARY_INCOMPLETE")
        complete = data_response([feature()])
        complete["response"].update({"record": {"total": "1", "current": "1"}, "page": {"total": "1", "current": "1"}})
        with patch.object(service, "_get_json", return_value=complete):
            self.assertEqual(len(service.fetch_parcel(PNU)["features"]), 1)
        for malformed in [True, "not-a-count", -1, 1.5]:
            payload = data_response([feature()]); payload["response"]["record"] = {"total": malformed}
            with patch.object(service, "_get_json", return_value=payload):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel(PNU)
            self.assertEqual(caught.exception.code, "UPSTREAM_FORMAT")

    def test_same_pnu_feature_parts_become_one_multipolygon_feature(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        multi = {"type": "MultiPolygon", "coordinates": [copy.deepcopy(POLYGON["coordinates"]), copy.deepcopy(POLYGON["coordinates"])]}
        first = feature()
        second = feature(geometry=multi)
        second["properties"]["addr"] = "다른 설명은 첫 Feature 속성을 덮지 않음"
        payload = data_response([first, second])
        before = copy.deepcopy(payload)
        with patch.object(service, "_get_json", return_value=payload):
            result = service.fetch_parcel(PNU)
        self.assertEqual(payload, before)
        self.assertEqual(len(result["features"]), 1, "one PNU occupies one of the five selectable parcel slots")
        merged = result["features"][0]
        self.assertEqual(merged["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(merged["geometry"]["coordinates"]), 3)
        self.assertTrue(all(polygon == POLYGON["coordinates"] for polygon in merged["geometry"]["coordinates"]))
        self.assertEqual(merged["properties"]["address"], first["properties"]["addr"])
        self.assertEqual(merged["properties"]["pnu"], PNU)
        self.assertEqual(merged["properties"]["source"], "vworld")
        too_many_coordinates = {"type": "Polygon", "coordinates": [[[127, 37]] * 1001]}
        with patch.object(service, "_get_json", return_value=data_response([
                feature(geometry=too_many_coordinates), feature(geometry=too_many_coordinates)])):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service.fetch_parcel(PNU)
        self.assertEqual(caught.exception.code, "INVALID_GEOMETRY", "the shared 2,000-coordinate budget still covers all parts")

    def test_fetch_rejects_bad_geometry_or_coordinate_budget(self):
        os.environ["VWORLD_API_KEY"] = "dummy"
        bad_geometries = [
            {"type": "Point", "coordinates": [127, 37]},
            {"type": "Polygon", "coordinates": [[[127, 37], [128, 37], [128, 38]]]},
            {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
            {"type": "Polygon", "coordinates": [[[127, 37], [True, 37], [128, 38], [127, 37]]]},
            {"type": "Polygon", "coordinates": [[[127, 37]] * 2001]},
        ]
        for geometry in bad_geometries:
            with patch.object(service, "_get_json", return_value=data_response([feature(geometry=geometry)])):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service.fetch_parcel(PNU)
            self.assertEqual(caught.exception.code, "INVALID_GEOMETRY")
        multi = {"type": "MultiPolygon", "coordinates": [copy.deepcopy(POLYGON["coordinates"])]}
        with patch.object(service, "_get_json", return_value=data_response([feature(geometry=multi)])):
            self.assertEqual(service.fetch_parcel(PNU)["features"][0]["geometry"], multi)

    def test_provider_error_does_not_copy_raw_error_or_key(self):
        os.environ["VWORLD_API_KEY"] = "SECRET_MUST_NOT_LEAK"
        payload = {"response": {"status": "ERROR", "error": {"text": "SECRET_MUST_NOT_LEAK: raw upstream traceback"}}}
        with patch.object(service, "_get_json", return_value=payload):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service.fetch_parcel(PNU)
        self.assertNotIn("SECRET_MUST_NOT_LEAK", str(caught.exception))
        self.assertNotIn("traceback", str(caught.exception))

    def test_transport_uses_only_fixed_https_host_encoded_query_and_timeout(self):
        fake_opener = unittest.mock.Mock()
        fake_opener.open.return_value = FakeResponse(b'{"ok": true}')
        with patch.object(service.request, "build_opener", return_value=fake_opener):
            self.assertEqual(service._get_json("juso", {"keyword": "https://127.0.0.1/private?key=abc"}), {"ok": True})
        req = fake_opener.open.call_args.args[0]
        self.assertTrue(req.full_url.startswith("https://business.juso.go.kr/addrlink/addrLinkApi.do?"))
        self.assertIn("keyword=https%3A%2F%2F", req.full_url)
        self.assertEqual(fake_opener.open.call_args.kwargs["timeout"], 5.0)
        with self.assertRaises(service.ParcelServiceError):
            service._get_json("https://untrusted.example/", {})
        with self.assertRaises(service.ParcelServiceError) as caught:
            service._NoRedirect().redirect_request(None, None, 302, "", {}, "https://untrusted.example/")
        self.assertEqual(caught.exception.code, "UPSTREAM_REDIRECT")

    def test_transport_caps_bytes_and_hides_url_in_http_errors(self):
        fake_opener = unittest.mock.Mock()
        for response in (FakeResponse(b"x" * (service._MAX_RESPONSE_BYTES + 1)),
                FakeResponse(b"{}", {"Content-Length": str(service._MAX_RESPONSE_BYTES + 1)})):
            fake_opener.open.return_value = response
            with patch.object(service.request, "build_opener", return_value=fake_opener):
                with self.assertRaises(service.ParcelServiceError) as caught:
                    service._get_json("juso", {})
            self.assertEqual(caught.exception.code, "UPSTREAM_TOO_LARGE")
        fake_opener.open.side_effect = error.HTTPError("https://host/?key=SECRET", 403, "SECRET", {}, io.BytesIO())
        with patch.object(service.request, "build_opener", return_value=fake_opener):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service._get_json("juso", {})
        self.assertEqual(caught.exception.code, "UPSTREAM_HTTP")
        self.assertNotIn("SECRET", str(caught.exception))

    def test_transport_nonfinite_json_and_timeout_are_public_errors(self):
        fake_opener = unittest.mock.Mock()
        fake_opener.open.return_value = FakeResponse(b'{"bad": NaN}')
        with patch.object(service.request, "build_opener", return_value=fake_opener):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service._get_json("juso", {})
        self.assertEqual(caught.exception.code, "UPSTREAM_FORMAT")
        fake_opener.open.side_effect = TimeoutError("sensitive URL must not be copied")
        with patch.object(service.request, "build_opener", return_value=fake_opener):
            with self.assertRaises(service.ParcelServiceError) as caught:
                service._get_json("juso", {})
        self.assertEqual(caught.exception.status, 504)


if __name__ == "__main__":
    unittest.main()
