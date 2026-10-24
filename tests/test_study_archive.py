"""Private review retention and explicit manual publication, without network calls."""
import copy
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import study_archive as archive


def sample(number=1):
    return {"summary": {"program": "office", "siteAreaSqm": 1000, "farPct": 200, "bcrPct": 50, "floors": 2},
            "model": {"plates": [
                {"level": level, "width": 20, "depth": 25, "height": 3.5,
                 "y": (level - .5) * 3.5, "shiftX": 0, "shiftZ": 0, "courtyard": False} for level in (1, 2)],
                "appearance": {"palette": "limestone", "facade": "curtain_wall"}},
            "site": {"parcels": [{"address": "비공개 주소 123", "pnu": f"{number:019d}"}],
                     "boundary": [{"x": -10, "z": -12.5}, {"x": 10, "z": -12.5}, {"x": 10, "z": 12.5}]},
            "reviewData": {"project": {"name": "비공개 금융 검토", "exportedAt": "2026-10-21T10:00:00+09:00"},
                           "calculations": {"totalCost": 12_345_678, "equityIrr": .1234, "key": "permitted-variable"},
                           "floorPlans": [{"level": 1, "rooms": []}], "legalEvidence": {"status": "conditional"},
                           "siteContext": None, "runtime": {"capturedAt": "2026-10-21T10:00:00+09:00", "version": 1}},
            "modelFingerprint": "a" * 64}


class StudyArchiveTests(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[2] / ".backups"
        parent.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="private-review-test-", dir=parent)
        self.env = patch.dict(os.environ, {"ARCHIVE_DB_PATH": str(Path(self.tmp.name) / "archive.sqlite3")})
        self.env.start()
        self.now = datetime(2026, 10, 21, 9, 0, tzinfo=archive.KST)
        self.clock = patch.object(archive, "_now", return_value=self.now)
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.env.stop()
        self.tmp.cleanup()

    def image(self, format_name="PNG", size=(640, 480)):
        path = Path(self.tmp.name) / f"manual.{format_name.lower()}"
        source = Image.new("RGB", size, "ivory")
        if format_name == "PNG":
            info = PngImagePlugin.PngInfo()
            info.add_text("private", "address-must-not-appear-in-image-metadata")
            source.save(path, format_name, pnginfo=info)
        else:
            source.save(path, format_name)
        return path

    def test_collect_retains_complete_private_json_and_never_publishes(self):
        result = archive.collect(sample())
        self.assertTrue(result["created"])
        self.assertEqual(result["review"], {"status": "collected"})
        study_id = result["study"]["id"]
        record = archive.get_review(study_id)
        self.assertEqual(record["schemaVersion"], 1)
        self.assertEqual(record["site"]["parcels"][0]["address"], "비공개 주소 123")
        self.assertEqual(record["site"]["parcels"][0]["pnu"], "0000000000000000001")
        self.assertEqual(record["reviewData"]["calculations"]["totalCost"], 12_345_678)
        self.assertEqual(record["review"], {"status": "pending"})
        disk = Path(self.tmp.name) / "records" / f"{study_id}.json"
        self.assertEqual(json.loads(disk.read_text(encoding="utf-8")), record)
        self.assertEqual(archive.list_studies()["total"], 0)
        self.assertIsNone(archive.get_image(study_id))
        self.assertNotIn("site", result)
        self.assertNotIn("reviewData", result)

    def test_dedup_ignores_clock_client_fingerprint_and_field_order_but_keeps_finance(self):
        first = archive.collect(sample())
        changed = sample()
        changed["modelFingerprint"] = "b" * 64
        changed["reviewData"]["project"]["exportedAt"] = "2027-01-01T00:00:00+09:00"
        changed["reviewData"]["runtime"]["capturedAt"] = "2027-01-01T00:00:00+09:00"
        changed["reviewData"]["project"]["savedAt"] = "2027-01-01T00:00:00+09:00"
        changed["reviewData"]["project"]["createdAt"] = "2027-01-01T00:00:00+09:00"
        changed["model"]["plates"].reverse()
        changed["site"]["parcels"][0]["address"] = "표현이 다른 같은 PNU"
        changed["site"]["boundary"].reverse()
        duplicate = archive.collect(changed)
        self.assertFalse(duplicate["created"])
        self.assertEqual(duplicate["study"]["id"], first["study"]["id"])
        changed["reviewData"]["calculations"]["totalCost"] += 1
        self.assertTrue(archive.collect(changed)["created"])
        self.assertTrue(archive.collect(sample(2))["created"])
        self.assertEqual(archive.list_weeks()["pendingCount"], 3)

    def test_parallel_collection_has_one_canonical_record_and_valid_atomic_json(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: archive.collect(sample()), range(2)))
        self.assertEqual(sum(int(item["created"]) for item in results), 1)
        self.assertEqual(len({item["study"]["id"] for item in results}), 1)
        self.assertEqual(len(list((Path(self.tmp.name) / "records").glob("*.json"))), 1)
        self.assertFalse(list((Path(self.tmp.name) / "records").glob("*.tmp")))

    def test_duplicate_collection_repairs_missing_file_without_losing_review(self):
        result = archive.collect(sample())
        path = Path(self.tmp.name) / "records" / f"{result['study']['id']}.json"
        path.unlink()
        self.assertFalse(archive.collect(sample())["created"])
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), archive.get_review(result["study"]["id"]))

    def test_unknown_fields_and_credentials_are_rejected_before_persistence(self):
        for field in ("apiKey", "api_key", "authorization", "access_token", "refresh_token", "password", "secretKey", "secret_key", "clientSecret", "sessionToken"):
            item = sample()
            item["reviewData"]["calculations"]["nested"] = [{field: "must-not-store"}]
            with self.subTest(field=field), self.assertRaises(ValueError):
                archive.collect(item)
        for field in ("imageDataUrl", "renderVersion", "unknown"):
            item = sample()
            item[field] = "extra"
            with self.subTest(field=field), self.assertRaises(ValueError):
                archive.collect(item)
        self.assertEqual(archive.list_weeks()["weeks"], [])

    def test_model_and_site_bounds_fail_closed(self):
        cases = []
        for name, value in (("width", float("nan")), ("height", 0), ("level", True), ("courtyard", "false"), ("shiftX", 10001), ("address", "private")):
            item = sample()
            item["model"]["plates"][0][name] = value
            cases.append(item)
        for pnu in ("123", 123, "a" * 19):
            item = sample()
            item["site"]["parcels"][0]["pnu"] = pnu
            cases.append(item)
        for boundary in ([{"lat": 37.5, "lng": 127}], [{"x": 10001, "z": 0}], [{"x": False, "z": 0}], [{"x": 0, "z": 0}] * 1001):
            item = sample()
            item["site"]["boundary"] = boundary
            cases.append(item)
        item = sample()
        item["site"]["parcels"] *= 6
        cases.append(item)
        for index, item in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(ValueError):
                archive.collect(item)
        self.assertEqual(archive.list_weeks()["pendingCount"], 0)

    def test_optional_boundary_and_address_only_site_are_retained(self):
        item = sample()
        item["site"] = {"parcels": [{"address": "  비공개   주소 123  ", "pnu": ""}]}
        result = archive.collect(item)
        self.assertEqual(archive.get_review(result["study"]["id"])["site"],
                         {"parcels": [{"address": "비공개 주소 123", "pnu": ""}], "boundary": []})

    def test_unverified_manual_or_preset_review_does_not_invent_parcel_data(self):
        item = sample()
        item["site"] = {"parcels": [], "boundary": []}
        item["reviewData"]["project"]["activeParcelKey"] = "manual-study-a"
        result = archive.collect(item)
        self.assertEqual(archive.get_review(result["study"]["id"])["site"], {"parcels": [], "boundary": []})
        self.assertFalse(archive.collect(item)["created"])
        item["reviewData"]["project"]["activeParcelKey"] = "manual-study-b"
        self.assertTrue(archive.collect(item)["created"])

    def test_zero_floor_unbuildable_legal_review_is_retained_privately(self):
        item = sample()
        item["summary"].update(floors=0, farPct=0, bcrPct=0)
        item["model"]["plates"] = []
        item["reviewData"]["calculations"] = {"actualBuildableFloors": 0, "permitted": False}
        item["reviewData"]["legalEvidence"] = {"status": "restricted", "reason": "용도지역·용도 제한 검토"}
        result = archive.collect(item)
        record = archive.get_review(result["study"]["id"])
        self.assertEqual(record["summary"]["floors"], 0)
        self.assertEqual(record["summary"]["farPct"], 0)
        self.assertEqual(record["summary"]["bcrPct"], 0)
        self.assertEqual(record["model"]["plates"], [])
        self.assertFalse(record["reviewData"]["calculations"]["permitted"])
        self.assertEqual(len(archive.export_week("2026-W43")["studies"]), 1)
        self.assertEqual(archive.list_studies()["total"], 0)

    def test_review_data_finite_depth_nodes_and_record_size_are_bounded(self):
        for value in (float("nan"), float("inf"), 10 ** 309, {1: "non-string-key"}, {"bad": object()}, "\ud800", {"\ud800": "bad-key"}):
            item = sample()
            item["reviewData"]["calculations"] = value
            with self.subTest(kind=type(value).__name__), self.assertRaises(ValueError):
                archive.collect(item)
        item = sample()
        nested = None
        for _ in range(82):
            nested = [nested]
        item["reviewData"]["calculations"] = nested
        with self.assertRaises(ValueError):
            archive.collect(item)
        with patch.object(archive, "MAX_TREE_NODES", 5), self.assertRaises(ValueError):
            archive.collect(sample())
        with patch.object(archive, "MAX_BODY_BYTES", 100), self.assertRaises(ValueError):
            archive.collect(sample())

    def test_kst_iso_week_boundary_and_calendar_year_transition(self):
        sunday = datetime(2026, 10, 25, 14, 59, tzinfo=timezone.utc).astimezone(archive.KST)
        monday = sunday + timedelta(minutes=1)
        with patch.object(archive, "_now", return_value=sunday):
            archive.collect(sample(1))
        with patch.object(archive, "_now", return_value=monday):
            archive.collect(sample(2))
        with patch.object(archive, "_now", return_value=datetime(2027, 1, 1, 9, tzinfo=archive.KST)):
            archive.collect(sample(3))
        weeks = archive.list_weeks()
        self.assertEqual([item["week"] for item in weeks["weeks"]], ["2026-W53", "2026-W44", "2026-W43"])
        exported = archive.export_week("2026-W43")
        self.assertEqual(len(exported["studies"]), 1)
        self.assertEqual(exported["period"]["start"], "2026-10-19T00:00:00+09:00")
        self.assertEqual(exported["period"]["end"], "2026-10-26T00:00:00+09:00")
        self.assertEqual(exported["period"]["timeZone"], "Asia/Seoul")
        self.assertTrue(exported["period"]["endExclusive"])
        self.assertIn("site", exported["studies"][0])
        for invalid in ("2026-W00", "2026-W54", "2025-W53", "../private", None):
            with self.subTest(week=invalid), self.assertRaises(ValueError):
                archive.export_week(invalid)

    def test_recent_export_is_seven_day_half_open_and_never_deletes_older_json(self):
        for index, days in enumerate((8, 7, 1, 0), 1):
            with patch.object(archive, "_now", return_value=self.now - timedelta(days=days)):
                archive.collect(sample(index))
        result = archive.export_recent(now=self.now)
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(list((Path(self.tmp.name) / "records").glob("*.json"))), 4)
        self.assertEqual(archive.list_weeks()["pendingCount"], 4)
        with self.assertRaises(ValueError):
            archive.export_recent(now=datetime(2026, 10, 21))

    def test_manual_publication_exposes_only_curated_image_and_safe_metadata(self):
        result = archive.collect(sample())
        study_id = result["study"]["id"]
        public = archive.publish_manual(study_id, self.image())
        self.assertEqual(public["curation"], "manual-reviewed")
        self.assertEqual(public["imageKind"], "ai-concept")
        self.assertEqual(public["renderVersion"], 3)
        feed = archive.list_studies()
        self.assertEqual(feed["total"], 1)
        self.assertEqual(feed["studies"][0], public)
        serialized = json.dumps(feed, ensure_ascii=False)
        for forbidden in ("비공개", "0000000000000000001", "totalCost", "equityIrr", "boundary", "reviewData", "modelFingerprint"):
            self.assertNotIn(forbidden, serialized)
        raw = archive.get_image(study_id)
        self.assertNotIn(b"address-must-not", raw)
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual(image.format, "PNG")
            self.assertEqual(image.info, {})
        self.assertEqual(archive.get_review(study_id)["review"]["status"], "reviewed")
        # An older in-flight duplicate cannot restore a pending JSON mirror.
        stale_record = {"id": study_id, "review": {"status": "pending"}}
        archive._write_record(stale_record)
        disk = Path(self.tmp.name) / "records" / f"{study_id}.json"
        self.assertEqual(json.loads(disk.read_text(encoding="utf-8"))["review"]["status"], "reviewed")
        self.assertEqual(archive.list_weeks()["pendingCount"], 0)
        self.assertEqual(len(archive.export_week("2026-W43")["studies"]), 1)

    def test_manual_jpeg_webp_and_large_image_are_normalized(self):
        for index, format_name in enumerate(("JPEG", "WEBP", "PNG"), 1):
            study_id = archive.collect(sample(index))["study"]["id"]
            archive.publish_manual(study_id, self.image(format_name, (2400, 1800)))
            with Image.open(io.BytesIO(archive.get_image(study_id))) as image:
                self.assertEqual(image.format, "PNG")
                self.assertEqual(image.size, (1600, 1200))

    def test_manual_image_replacement_changes_cache_revision_and_has_safe_limit(self):
        study_id = archive.collect(sample())["study"]["id"]
        first = archive.publish_manual(study_id, self.image())
        second = archive.publish_manual(study_id, self.image("JPEG"))
        self.assertEqual(first["renderVersion"], 3)
        self.assertEqual(second["renderVersion"], 4)
        self.assertEqual(archive.list_studies()["studies"][0]["renderVersion"], 4)
        with archive._connect() as conn:
            conn.execute("UPDATE study_reviews SET image_revision=100 WHERE id=?", (study_id,))
        with self.assertRaises(ValueError) as error:
            archive.publish_manual(study_id, self.image())
        self.assertEqual(error.exception.code, "IMAGE_REVISION_LIMIT")

    def test_revision_column_migrates_existing_archive_without_data_loss(self):
        with closing(sqlite3.connect(archive.database_path())) as conn:
            conn.execute("CREATE TABLE study_reviews (id TEXT PRIMARY KEY,record TEXT NOT NULL,week TEXT NOT NULL,collected_at TEXT NOT NULL,manual_image BLOB,published_at TEXT)")
            conn.commit()
        result = archive.collect(sample())
        self.assertIsNotNone(archive.get_review(result["study"]["id"]))
        self.assertEqual(archive.publish_manual(result["study"]["id"], self.image())["renderVersion"], 3)

    def test_bad_manual_files_and_missing_records_cannot_publish(self):
        study_id = archive.collect(sample())["study"]["id"]
        path = Path(self.tmp.name) / "not-an-image.png"
        path.write_text("not an image", encoding="utf-8")
        with self.assertRaises(ValueError):
            archive.publish_manual(study_id, path)
        with patch.object(archive, "MAX_IMAGE_BYTES", 10), self.assertRaises(ValueError):
            archive.publish_manual(study_id, self.image())
        with self.assertRaises(ValueError):
            archive.publish_manual("0" * 24, self.image())
        self.assertIsNone(archive.get_image("../private"))
        self.assertIsNone(archive.get_review("../private"))
        self.assertEqual(archive.list_studies()["total"], 0)

    def test_logical_storage_and_count_limits_fail_without_deleting_existing(self):
        with patch.object(archive, "MAX_RECORDS", 1):
            archive.collect(sample(1))
            self.assertFalse(archive.collect(sample(1))["created"])
            with self.assertRaises(ValueError):
                archive.collect(sample(2))
        with patch.object(archive, "MAX_STORAGE_BYTES", 1), self.assertRaises(ValueError):
            archive.collect(sample(2))
        self.assertEqual(archive.list_weeks()["pendingCount"], 1)


if __name__ == "__main__":
    unittest.main()
