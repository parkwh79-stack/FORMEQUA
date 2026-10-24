import base64
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import study_catalog as catalog


def sample(color="#ddd8c9"):
    image = Image.new("RGB", (640, 480), color)
    meta = PngImagePlugin.PngInfo()
    meta.add_text("private", "address-and-price-must-not-persist")
    buf = io.BytesIO()
    image.save(buf, "PNG", pnginfo=meta)
    return {"summary": {"program": "hotel", "siteAreaSqm": 923.7, "farPct": 312.345, "bcrPct": 52.567, "floors": 6},
            "imageDataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            "modelFingerprint": "a" * 64, "renderVersion": 2}


class CatalogTests(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parents[2] / ".backups"
        temporary_root.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="study-catalog-test-", dir=temporary_root)
        self.env = patch.dict(os.environ, {"STUDIES_DB_PATH": str(Path(self.tmp.name) / "catalog.sqlite3")})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_persistence_duplicates_and_metadata_removal(self):
        result = catalog.publish(sample())
        self.assertTrue(result["created"])
        self.assertEqual(result["study"]["siteAreaSqm"], 920)
        self.assertEqual(result["study"]["farPct"], 312.3)
        self.assertEqual(catalog.publish(sample())["created"], False)
        listing = catalog.list_studies()
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["studies"][0], result["study"])
        png = catalog.get_image(result["study"]["id"])
        self.assertNotIn(b"address-and-price", png)
        with Image.open(io.BytesIO(png)) as image:
            self.assertEqual(image.info, {})
        self.assertNotIn("imageDataUrl", result["study"])
        self.assertNotIn("modelFingerprint", result["study"])

    def test_private_fields_fail_closed(self):
        for field in ["address", "pnu", "finance", "projectId", "geometryKey"]:
            item = sample()
            item["summary"][field] = "private"
            with self.assertRaises(catalog.CatalogError):
                catalog.publish(item)
            item = sample()
            item[field] = "private"
            with self.assertRaises(catalog.CatalogError):
                catalog.publish(item)
        self.assertEqual(catalog.list_studies()["total"], 0)

    def test_anonymous_geometry_identity_and_render_upgrade(self):
        first = catalog.publish(sample())
        alternate_image = sample("#958e7b")
        # Rendering the same anonymous building again does not create a new study.
        self.assertFalse(catalog.publish(alternate_image)["created"])
        self.assertEqual(catalog.get_image(first["study"]["id"]), catalog.clean_image(sample()["imageDataUrl"]))
        alternate_image["renderVersion"] = 3
        upgraded = catalog.publish(alternate_image)
        self.assertEqual(upgraded["study"]["id"], first["study"]["id"])
        self.assertEqual(upgraded["study"]["renderVersion"], 3)
        self.assertEqual(catalog.get_image(first["study"]["id"]), catalog.clean_image(alternate_image["imageDataUrl"]))
        alternate_building = sample()
        alternate_building["modelFingerprint"] = "b" * 64
        self.assertTrue(catalog.publish(alternate_building)["created"])
        self.assertEqual(catalog.list_studies()["total"], 2)

    def test_legacy_images_retained_but_archived_until_local_upgrade(self):
        legacy = sample()
        legacy.pop("renderVersion")
        legacy.pop("modelFingerprint")
        first = catalog.publish(legacy)
        self.assertEqual(catalog.list_studies()["total"], 0)
        self.assertEqual(catalog.list_studies(include_legacy=True)["total"], 1)
        self.assertIsNotNone(catalog.get_image(first["study"]["id"]))
        self.assertTrue(catalog.replace_image(first["study"]["id"], sample("#b9b09b")["imageDataUrl"]))
        self.assertEqual(catalog.list_studies()["total"], 1)
        self.assertFalse(catalog.replace_image("0" * 24, sample()["imageDataUrl"]))

    def test_old_four_column_schema_migrates_without_deleting_images(self):
        with closing(sqlite3.connect(catalog.database_path())) as conn:
            conn.execute("CREATE TABLE studies (id TEXT PRIMARY KEY, summary TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT NOT NULL)")
            conn.execute("INSERT INTO studies VALUES (?,?,?,?)", ("e" * 24, '{"program":"hotel","floors":6}', b"existing-image", "2026-10-20T00:00:00Z"))
            conn.commit()
        self.assertEqual(catalog.list_studies()["total"], 0)
        self.assertEqual(catalog.list_studies(include_legacy=True)["total"], 1)
        self.assertEqual(catalog.get_image("e" * 24), b"existing-image")
        self.assertTrue(catalog.publish(sample())["created"])

    def test_continuous_pagination_beyond_sixty(self):
        for number in range(73):
            item = sample()
            item["modelFingerprint"] = f"{number:064x}"
            catalog.publish(item)
        seen, offset = set(), 0
        while offset is not None:
            page = catalog.list_studies(6, offset)
            self.assertEqual(page["total"], 73)
            ids = {study["id"] for study in page["studies"]}
            self.assertFalse(ids & seen)
            seen |= ids
            offset = page["nextOffset"]
        self.assertEqual(len(seen), 73)
        self.assertEqual(catalog.list_studies(60, 500_000)["studies"], [])

    def test_configurable_bounded_capacity_and_metadata_validation(self):
        with patch.dict(os.environ, {"STUDIES_MAX_RECORDS": "30000", "STUDIES_MAX_IMAGE_BYTES": "2000000000"}):
            self.assertEqual(catalog.storage_limits(), (30000, 2000000000))
        with patch.dict(os.environ, {"STUDIES_MAX_RECORDS": "99999999999", "STUDIES_MAX_IMAGE_BYTES": "9999999999999"}):
            self.assertEqual(catalog.storage_limits(), (1_000_000, 107_374_182_400))
        for field, value in [("modelFingerprint", "address"), ("modelFingerprint", "A" * 64), ("modelFingerprint", []),
                             ("renderVersion", True), ("renderVersion", 0), ("renderVersion", 101)]:
            item = sample()
            item[field] = value
            with self.assertRaises(catalog.CatalogError):
                catalog.publish(item)

    def test_invalid_data_never_persisted(self):
        for key, value in [("program", []), ("program", "logistics"), ("farPct", float("nan")),
                           ("bcrPct", True), ("floors", 2.5), ("floors", 500), ("siteAreaSqm", 0), ("siteAreaSqm", 10**310)]:
            item = sample()
            item["summary"][key] = value
            with self.assertRaises(catalog.CatalogError):
                catalog.publish(item)
        for image in ["https://untrusted.test/image.png", "data:image/png;base64,%%%", "data:image/svg+xml;base64,abcd"]:
            item = sample()
            item["imageDataUrl"] = image
            with self.assertRaises(catalog.CatalogError):
                catalog.publish(item)
        self.assertIsNone(catalog.get_image("../private"))
        self.assertEqual(catalog.list_studies()["total"], 0)

    def test_storage_cap_and_pagination(self):
        with patch.object(catalog, "MAX_STUDIES", 1):
            catalog.publish(sample())
            item = sample()
            item["summary"]["floors"] = 8
            with self.assertRaises(catalog.CatalogError) as error:
                catalog.publish(item)
            self.assertEqual(error.exception.code, "CATALOG_FULL")
            self.assertFalse(catalog.publish(sample())["created"])
        self.assertEqual(catalog.list_studies(1, 1)["studies"], [])
        item = sample()
        item["summary"]["floors"] = 10
        with patch.object(catalog, "MAX_TOTAL_IMAGE_BYTES", 1):
            with self.assertRaises(catalog.CatalogError) as error:
                catalog.publish(item)
            self.assertEqual(error.exception.code, "CATALOG_FULL")


if __name__ == "__main__":
    unittest.main()
