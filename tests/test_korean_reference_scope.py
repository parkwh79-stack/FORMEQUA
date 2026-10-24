"""Audit regressions: legacy Korean CLIs cannot invent legal verification."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "runtime" / "Skills-Architects" / "skills" / "korea-area-and-parking" / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location("audit_" + name, SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


egress = load("kr_egress_calculator")
area = load("kr_area_parking_calculator")


def egress_inputs(**extra):
    values = dict(floor_area=500, habitable_area=450, use_type="office", ground_floors=2,
                  basement_floors=0, fireproof=True, sprinklered=True, max_travel_distance=40)
    values.update(extra)
    return SimpleNamespace(**values)


def area_inputs(**extra):
    values = dict(site_area=1000, road_setback_area=0, public_contribution_area=0,
        zone="general_commercial", region="seoul", offline=True, oc="test", seoul_downtown=False,
        ordinance_bcr_limit=None, ordinance_far_limit=None, bcr_pct=60, far_pct=None,
        ground_floors=10, core_ratio=.22, building_use="office", avg_exclusive_unit_m2=None,
        parking_m2_per_stall=None, strict_parking_ceil=False, parking_buffer_ratio=1.05,
        m2_per_parking_bay=35, basement_mep_ratio=.08, basement_footprint_ratio=.8,
        district_plan_status="NEEDS_VERIFICATION")
    values.update(extra)
    return SimpleNamespace(**values)


class Response:
    def __init__(self, value):
        self.value = value.encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def read(self):
        return self.value


SEARCH = "<root><law><자치법규명>서울특별시 도시계획 조례</자치법규명><자치법규일련번호>TEST-ONLY</자치법규일련번호><시행일자>20261021</시행일자></law></root>"


class KoreanReferenceScopeTests(unittest.TestCase):
    def test_egress_cannot_repeat_false_story_or_stair_triggers(self):
        cases = [egress_inputs(),
            egress_inputs(floor_area=300, habitable_area=250, ground_floors=11),
            egress_inputs(floor_area=100, habitable_area=80, ground_floors=2, use_type="retail")]
        for args in cases:
            result = egress.calculate(args)
            self.assertIsNone(result["egress_requirements"]["required_direct_stairs"])
            self.assertIsNone(result["egress_requirements"]["required_stair_type"])
            self.assertIsNone(result["egress_requirements"]["min_stair_effective_width_mm"])
            self.assertIsNone(result["fire_compartmentation"]["vertical_floor_by_floor_required"])
            self.assertEqual(result["assessment_status"], "NEEDS_VERIFICATION")
            self.assertIn("추가 확인 필요", egress.format_output(result))

    def test_missing_habitable_area_and_default_travel_do_not_become_verified(self):
        result = egress.calculate(egress_inputs(habitable_area=None))
        self.assertIsNone(result["inputs"]["habitable_area_m2"])
        self.assertEqual(result["inputs"]["planned_max_travel_distance_m"], 40)
        self.assertEqual(result["egress_requirements"]["travel_distance_status"], "NEEDS_VERIFICATION")
        record = result["evidence_records"][0]
        self.assertIsNone(record["retrieved_at"])
        self.assertIsNone(record["reference_date"])
        self.assertEqual(record["verification_status"], "NEEDS_VERIFICATION")
        self.assertTrue(record["calculated_at"])
        self.assertFalse(record["source_retrieved_this_run"])

    def test_contribution_does_not_automatically_award_bonus(self):
        result = area.calculate(area_inputs(public_contribution_area=100))
        self.assertEqual(result["site_summary"]["buildable_site_area_m2"], 900)
        self.assertEqual(result["korean_8_area_table"]["4_far_countable_gfa_m2"], 7200)
        self.assertEqual(result["illustrative_assumptions"]["density_reference_far_pct"], 800)
        self.assertFalse(result["illustrative_assumptions"]["incentive_applied"])
        self.assertIsNone(result["zoning_and_density"]["ordinance_limit_far_pct"])
        self.assertEqual(result["zoning_and_density"]["far_status"], "NEEDS_VERIFICATION")

    def test_legacy_parking_values_are_not_exported_as_statutory_counts(self):
        for use in ["office", "retail", "officetel", "apartment"]:
            result = area.calculate(area_inputs(building_use=use, far_pct=100, avg_exclusive_unit_m2=50))
            parking = result["parking_and_landscape"]
            for key in ["statutory_required_stalls", "disabled_stalls_min", "ev_charging_stalls_min", "required_landscape_area_m2"]:
                self.assertIsNone(parking[key])
            self.assertEqual(parking["status"], "NEEDS_VERIFICATION")
            self.assertTrue(result["illustrative_assumptions"]["parking_basis"])
            self.assertIn("법정 주차대수:          미확인", area.format_output(result))
            self.assertIsNone(result["evidence_records"][0]["retrieved_at"])

    def test_empty_official_article_body_does_not_verify_static_zones(self):
        with patch.object(area.urllib.request, "urlopen", side_effect=[Response(SEARCH), Response("<root/>")]):
            with self.assertRaisesRegex(ValueError, "Required zoning articles"):
                area.fetch_live_seoul_ordinance_bcr_far(oc="test")
        with patch.object(area, "fetch_live_seoul_ordinance_bcr_far", side_effect=ValueError("missing articles")):
            result = area.calculate(area_inputs(offline=False))
        self.assertEqual(result["zoning_and_density"]["live_law_api_sync"]["status"], "FALLBACK_STATIC")
        self.assertEqual(result["evidence_records"][0]["verification_status"], "NEEDS_VERIFICATION")
        self.assertIsNone(result["evidence_records"][0]["retrieved_at"])

    def test_partially_parsed_source_marks_each_unconfirmed_zone(self):
        body = "<root><조><조제목>용도지역 안에서의 건폐율</조제목><조내용>제44조 제2종일반주거지역: 60퍼센트</조내용></조><조><조제목>용도지역 안에서의 용적률</조제목><조내용>제48조 제2종일반주거지역: 200퍼센트</조내용></조></root>"
        with patch.object(area.urllib.request, "urlopen", side_effect=[Response(SEARCH), Response(body)]):
            result = area.fetch_live_seoul_ordinance_bcr_far(oc="test")
        self.assertEqual(result["status"], "PARTIAL_LIVE_REFERENCE")
        self.assertEqual(result["zones"]["제2종일반주거지역"]["verification_status"], "PARSED_OFFICIAL_TEXT")
        self.assertEqual(result["zones"]["일반상업지역"]["verification_status"], "NEEDS_VERIFICATION")
        self.assertEqual(result["zones"]["일반상업지역"]["far_source"], "static-reference-assumption")


if __name__ == "__main__":
    unittest.main()
