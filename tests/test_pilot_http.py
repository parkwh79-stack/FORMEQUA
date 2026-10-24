"""HTTP boundaries for private full-review JSON and owner-curated public images."""
import base64
import copy
import io
import json
import os
import socketserver
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pilot_security
import server as app


def review_payload():
    return {"summary": {"program": "office", "siteAreaSqm": 843.4, "farPct": 100, "bcrPct": 50, "floors": 1},
            "model": {"plates": [{"level": 1, "width": 20, "depth": 20, "height": 4, "y": 2,
                                   "shiftX": 0, "shiftZ": 0, "courtyard": False}],
                      "appearance": {"palette": "limestone", "facade": "curtain_wall"}},
            "site": {"parcels": [{"address": "비공개 검토주소 123", "pnu": "1168010100108230000"}], "boundary": []},
            "reviewData": {"project": {"inputs": {"rentPyeongMan": 14}},
                           "calculations": {"finance": {"totalCost": 123456.7}},
                           "floorPlans": [], "legalEvidence": {"status": "unconfirmed"},
                           "siteContext": None, "runtime": {"capturedAt": "2026-10-21T10:00:00+09:00"}},
            "modelFingerprint": "a" * 64}


class QuietHandler(app.Seoul3DRequestHandler):
    def log_request(self, *args):
        pass


class PilotHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), QuietHandler)
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ARCHIVE_DB_PATH": str(Path(self.tmp.name) / "archive.sqlite3"),
            "PILOT_PASSWORD": "", "PUBLIC_ORIGIN": "https://pilot.example"})
        self.env.start()
        with pilot_security._LOCK:
            pilot_security._BUCKETS.clear()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def request(self, path, payload=None, method=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def test_static_files_and_head_cannot_leak_backend_or_records(self):
        for method in ["GET", "HEAD"]:
            for path in ["/server.py", "/study_archive.py", "/study_review_tools.py", "/analysis-engine.js",
                         "/ANALYSIS-ENGINE.JS", "/docs/manual-study-review.md", "/tests/", "/assets/../server.py",
                         "/.pilot-data/study-review/archive.sqlite3", "/.pilot-data/study-review/weekly/x.json",
                         "/app.js.map", "/%73erver.py"]:
                self.assertEqual(self.request(path, method=method)[0], 404, (method, path))
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/app.js")[0], 200)
        self.assertEqual(self.request("/law-evidence/manifest.json")[0], 200)

    def test_dashboard_and_private_submission_auth(self):
        with patch.dict(os.environ, {"PILOT_PASSWORD": "this-is-a-test-password"}):
            for path in ["/dashboard.html", "/DASHBOARD.HTML", "/%64ashboard.html", "/dashboard%2ehtml"]:
                for method in ["GET", "HEAD"]:
                    self.assertIn(self.request(path, method=method)[0], (401, 404))
            self.assertEqual(self.request("/api/v1/study-reviews", review_payload())[0], 401)
            auth = "Basic " + base64.b64encode(b"formequa:this-is-a-test-password").decode()
            self.assertEqual(self.request("/dashboard.html", headers={"Authorization": auth})[0], 200)
            self.assertEqual(self.request("/api/v1/study-reviews", review_payload(), headers={"Authorization": auth})[0], 201)
            # A shared pilot password never grants access to other users' full records.
            for path in ["/api/v1/study-reviews", "/api/v1/study-reviews/weeks", "/api/v1/study-reviews/export?week=2026-W43"]:
                self.assertEqual(self.request(path, headers={"Authorization": auth})[0], 404)
            self.assertEqual(self.request("/")[0], 200)
            self.assertEqual(self.request("/api/v1/studies")[0], 200)

    def test_same_origin_and_security_headers(self):
        self.assertEqual(self.request("/api/v1/study-reviews", review_payload(), headers={"Origin": "https://foreign.example"})[0], 403)
        status, body, headers = self.request("/api/v1/studies", headers={"Origin": "https://pilot.example"})
        self.assertEqual(status, 200)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("object-src 'none'", headers["Content-Security-Policy"])
        health = json.loads(self.request("/api/health")[1])
        self.assertNotIn("skills_root", health)

    def test_full_record_saved_but_only_manual_image_can_be_public(self):
        payload = review_payload()
        status, body, _ = self.request("/api/v1/study-reviews", payload)
        self.assertEqual(status, 201, body)
        result = json.loads(body)
        self.assertEqual(result["review"]["status"], "collected")
        study_id = result["study"]["id"]
        self.assertEqual(self.request("/api/v1/study-reviews", payload)[0], 200)
        record = app.study_archive.get_review(study_id)
        self.assertEqual(record["site"]["parcels"][0]["pnu"], payload["site"]["parcels"][0]["pnu"])
        self.assertEqual(record["reviewData"]["calculations"]["finance"]["totalCost"], 123456.7)
        self.assertTrue((Path(self.tmp.name) / "records" / f"{study_id}.json").exists())
        self.assertEqual(json.loads(self.request("/api/v1/studies")[1])["total"], 0)
        self.assertEqual(self.request(f"/api/v1/studies/{study_id}/image.png")[0], 404)
        self.assertEqual(self.request(f"/api/v1/study-reviews/{study_id}/json")[0], 404)
        image = Path(self.tmp.name) / "owner-concept.png"
        Image.new("RGB", (640, 480), "ivory").save(image)
        app.study_archive.publish_manual(study_id, image)
        listing = json.loads(self.request("/api/v1/studies")[1])
        self.assertEqual(listing["total"], 1)
        encoded = json.dumps(listing)
        for private in [payload["site"]["parcels"][0]["pnu"], "123456.7", "reviewData", "siteContext", "finance"]:
            self.assertNotIn(private, encoded)
        self.assertEqual(listing["studies"][0]["curation"], "manual-reviewed")
        status, pixels, headers = self.request(listing["studies"][0]["imageUrl"])
        self.assertEqual(status, 200)
        self.assertTrue(pixels.startswith(b"\x89PNG"))

    def test_obsolete_automatic_routes_are_gone(self):
        self.assertEqual(self.request("/api/v1/studies", {})[0], 410)
        self.assertEqual(self.request("/api/v1/studies/provider-status")[0], 410)
        self.assertEqual(self.request("/api/v1/studies/" + "a" * 24 + "/status")[0], 410)

    def test_credentials_and_unknown_fields_cannot_enter_archive(self):
        payload = review_payload()
        payload["reviewData"]["project"]["apiKey"] = "must-not-store"
        self.assertEqual(self.request("/api/v1/study-reviews", payload)[0], 400)
        payload = review_payload()
        payload["imageDataUrl"] = "unsupported"
        self.assertEqual(self.request("/api/v1/study-reviews", payload)[0], 400)

    def test_write_rate_limit(self):
        for _ in range(6):
            self.assertEqual(self.request("/api/v1/study-reviews", {})[0], 400)
        self.assertEqual(self.request("/api/v1/study-reviews", {})[0], 429)

    def test_oversized_integer_is_client_error(self):
        for path in ["/api/v1/study-reviews", "/api/v1/analysis", "/api/calculate-skills"]:
            self.assertEqual(self.request(path, {"site_area": 10**310})[0], 400)

    def test_public_config_fails_without_protection(self):
        with patch.dict(os.environ, {"BIND_HOST": "0.0.0.0", "PILOT_PASSWORD": ""}):
            with self.assertRaises(ValueError):
                pilot_security.validate_public_config()


if __name__ == "__main__":
    unittest.main()
