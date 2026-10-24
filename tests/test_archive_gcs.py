"""Durable archive contract using a concurrent generation-checked fake store."""
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_gcs as cloud
import study_archive as archive
import study_review_tools as tools
from archive_storage import Conflict, StorageUnavailable
from test_study_archive import sample


class MemoryStore:
    def __init__(self):
        self.values = {}
        self.generation = 0
        self.lock = threading.Lock()
        self.fail_records = False
        self.conflicts = 0

    def read(self, key, max_bytes):
        with self.lock:
            value = self.values.get(key)
            if value and len(value[0]) > max_bytes:
                raise StorageUnavailable()
            return value

    def write(self, key, data, generation=0, content_type="application/json"):
        with self.lock:
            if self.fail_records and "/records/" in key:
                raise StorageUnavailable()
            current = self.values.get(key)
            if self.conflicts and key.endswith("index.json"):
                self.conflicts -= 1
                raise Conflict()
            if (current[1] if current else 0) != generation:
                raise Conflict()
            self.generation += 1
            self.values[key] = (bytes(data), self.generation)
            return self.generation


class CloudArchiveTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.env = patch.dict(os.environ, {"ARCHIVE_BACKEND": "gcs", "ARCHIVE_BUCKET": "private-test-bucket", "K_SERVICE": ""})
        self.env.start()
        self.factory = patch.object(cloud, "store", return_value=self.store)
        self.factory.start()

    def tearDown(self):
        self.factory.stop()
        self.env.stop()

    def test_durable_complete_json_and_duplicate_after_worker_restart(self):
        first = archive.collect(sample())
        study_id = first["study"]["id"]
        self.assertTrue(first["created"])
        cloud._store_for.cache_clear()
        self.assertFalse(archive.collect(sample())["created"])
        self.assertEqual(archive.get_review(study_id)["reviewData"]["calculations"]["totalCost"], 12345678)
        self.assertEqual(archive.get_review(study_id)["site"]["parcels"][0]["pnu"], "0000000000000000001")
        self.assertEqual(archive.list_studies()["total"], 0)
        self.assertIsNone(archive.get_image(study_id))

    def test_parallel_dedup_and_generation_conflict_retry(self):
        self.store.conflicts = 2
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: archive.collect(sample()), range(4)))
        self.assertEqual(sum(int(result["created"]) for result in results), 1)
        self.assertEqual(archive.list_weeks()["pendingCount"], 1)
        self.assertEqual(sum("/records/" in key for key in self.store.values), 1)

    def test_upload_failure_is_not_success_and_retry_repairs_reservation(self):
        self.store.fail_records = True
        with self.assertRaises(archive.CatalogError) as failure:
            archive.collect(sample())
        self.assertEqual(failure.exception.status, 503)
        self.assertEqual(archive.list_weeks()["pendingCount"], 0)
        self.store.fail_records = False
        self.assertEqual(archive.collect(sample())["review"]["status"], "collected")
        self.assertEqual(archive.list_weeks()["pendingCount"], 1)

    def test_failed_upload_still_counts_quota_and_cannot_fall_back_to_sqlite(self):
        with patch.object(archive, "MAX_RECORDS", 1):
            self.store.fail_records = True
            with self.assertRaises(archive.CatalogError):
                archive.collect(sample(1))
            self.store.fail_records = False
            with self.assertRaises(archive.CatalogError) as failure:
                archive.collect(sample(2))
            self.assertEqual(failure.exception.code, "ARCHIVE_FULL")
            archive.collect(sample(1))
        with patch.dict(os.environ, {"K_SERVICE": "formequa-api", "ARCHIVE_BACKEND": "sqlite"}):
            with self.assertRaises(archive.CatalogError):
                archive.collect(sample(3))
        with patch.object(cloud, "store", side_effect=StorageUnavailable()), self.assertRaises(archive.CatalogError):
            archive.collect(sample(3))

    def test_private_to_public_boundary_and_curated_image_only(self):
        study_id = archive.collect(sample())["study"]["id"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "manual.png"
            Image.new("RGB", (640, 480), "ivory").save(path)
            public = archive.publish_manual(study_id, path)
            self.assertEqual(public["renderVersion"], 3)
            self.assertEqual(archive.publish_manual(study_id, path)["renderVersion"], 4)
        feed = archive.list_studies()
        self.assertEqual(feed["total"], 1)
        serialized = json.dumps(feed, ensure_ascii=False)
        for private in ("비공개", "0000000000000000001", "totalCost", "reviewData", "imageKey", "collectedAt", "site"):
            self.assertNotIn(private, serialized)
        self.assertEqual(archive.get_review(study_id)["review"]["status"], "reviewed")
        self.assertEqual(archive.list_weeks()["pendingCount"], 0)
        self.assertTrue(archive.get_image(study_id).startswith(b"\x89PNG"))
        self.assertIsNone(archive.get_image("../index"))

    def test_weekly_owner_export_uses_remote_source_and_local_cursor(self):
        from datetime import datetime, timedelta
        end = datetime(2026, 10, 23, 12, 0, tzinfo=archive.KST)
        with patch.object(archive, "_now", return_value=end - timedelta(days=1)):
            archive.collect(sample())
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"ARCHIVE_DB_PATH": str(Path(folder) / "unused.sqlite3")}):
            with patch.object(tools, "datetime", wraps=datetime) as clock:
                clock.now.return_value = end
                result = tools.weekly_report()
            self.assertEqual(result["count"], 1)
            report = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
            self.assertIn("site", report["studies"][0])
            self.assertFalse((Path(folder) / "unused.sqlite3").exists())
        self.assertEqual(len(archive.export_week("2026-W43")["studies"]), 1)

    def test_invalid_credentials_and_storage_configuration_fail_closed(self):
        bad = sample()
        bad["reviewData"]["project"]["apiKey"] = "not-allowed"
        with self.assertRaises(archive.CatalogError):
            archive.collect(bad)
        for config in ({"ARCHIVE_BUCKET": ""}, {"ARCHIVE_BACKEND": "typo"}):
            with patch.dict(os.environ, config), self.assertRaises(archive.CatalogError):
                archive.collect(sample())
        self.assertEqual(self.store.values, {})
