"""Exercise the Gunicorn WSGI application without opening any network socket."""
import base64
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_app
import pilot_security
from test_pilot_http import review_payload


class CloudAppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ARCHIVE_BACKEND": "sqlite", "K_SERVICE": "", "PUBLIC_ORIGIN": "https://pilot.example",
            "PILOT_PASSWORD": "test-password-for-pilot", "WORKSPACE_ENTRY": "private",
            "ARCHIVE_DB_PATH": str(Path(self.temp.name) / "archive.sqlite3")})
        self.env.start()
        self.app = validator(cloud_app.create_app())
        with pilot_security._LOCK:
            pilot_security._BUCKETS.clear()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def call(self, path, payload=None, auth=False, origin=None, method=None):
        env = {}
        setup_testing_defaults(env)
        env.update(REQUEST_METHOD=method or ("POST" if payload is not None else "GET"), PATH_INFO=path,
                   RAW_URI=path, SERVER_PORT="8090", REMOTE_ADDR="127.0.0.1", QUERY_STRING="")
        if auth:
            env["HTTP_AUTHORIZATION"] = "Basic " + base64.b64encode(b"formequa:test-password-for-pilot").decode()
        if origin:
            env["HTTP_ORIGIN"] = origin
        if payload is not None:
            data = json.dumps(payload).encode()
            env.update(CONTENT_TYPE="application/json", CONTENT_LENGTH=str(len(data)))
            env["wsgi.input"] = io.BytesIO(data)
        result = {}
        def start_response(status, headers, exc_info=None):
            result.update(status=int(status.split()[0]), headers=dict(headers))
        response = self.app(env, start_response)
        try:
            body = b"".join(response)
        finally:
            response.close()
        return result["status"], body, result["headers"]

    def test_health_and_protected_dashboard(self):
        self.assertEqual(self.call("/api/health")[0], 200)
        self.assertEqual(self.call("/dashboard.html")[0], 401)
        status, body, headers = self.call("/dashboard.html", auth=True)
        self.assertEqual(status, 200)
        self.assertIn(b"FORMEQUA", body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.call("/dashboard.html", auth=True, method="HEAD")[1], b"")

    def test_private_records_remain_unreadable_with_pilot_password(self):
        self.assertEqual(self.call("/api/v1/study-reviews", review_payload())[0], 401)
        self.assertEqual(self.call("/api/v1/study-reviews", review_payload(), auth=True)[0], 201)
        for path in ("/api/v1/study-reviews", "/api/v1/study-reviews/weeks", "/api/v1/study-reviews/export"):
            self.assertEqual(self.call(path, auth=True)[0], 404)
        self.assertEqual(json.loads(self.call("/api/v1/studies")[1])["total"], 0)

    def test_public_model_is_separate_from_private_workbench_and_apis(self):
        status, body, headers = self.call("/model.html")
        self.assertEqual(status, 200)
        self.assertIn(b'data-public-model="true"', body)
        self.assertNotIn("WWW-Authenticate", headers)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.call("/model.html", method="HEAD")[0:2], (200, b""))
        self.assertEqual(self.call("/dashboard.html")[0], 401)
        for path in ("/api/v1/analysis", "/api/calculate-skills", "/api/v1/parcels/status", "/api/law-lookup", "/api/v1/study-reviews"):
            self.assertEqual(self.call(path)[0], 401, path)
        self.assertEqual(self.call("/api/v1/analysis", {"schemaVersion": 1})[0], 401)
        self.assertEqual(self.call("/model.html", {"schemaVersion": 1})[0], 404)

    def test_production_workbench_entry_goes_to_contact_without_a_login_prompt(self):
        with patch.dict(os.environ, {"WORKSPACE_ENTRY": "contact"}):
            for method in ("GET", "HEAD"):
                status, body, headers = self.call("/dashboard.html", method=method)
                self.assertEqual((status, body), (303, b""))
                self.assertEqual(headers["Location"], "https://wan2-website.web.app/")
                self.assertNotIn("WWW-Authenticate", headers)
            env = {}
            setup_testing_defaults(env)
            env.update(REQUEST_METHOD="GET", PATH_INFO="/dashboard.html", RAW_URI="/dashboard.html?view=model&returnTo=%23studio", REMOTE_ADDR="127.0.0.1", QUERY_STRING="view=model&returnTo=%23studio")
            result = {}
            response = self.app(env, lambda status, headers, exc_info=None: result.update(status=int(status.split()[0]), headers=dict(headers)))
            try:
                self.assertEqual(b"".join(response), b"")
            finally:
                response.close()
            self.assertEqual(result["status"], 303)
            self.assertEqual(result["headers"]["Location"], "/model.html?view=model&returnTo=%23studio")
            self.assertNotIn("WWW-Authenticate", result["headers"])
            self.assertEqual(self.call("/api/v1/study-reviews", review_payload())[0], 401)

    def test_static_backend_and_encoded_paths_are_not_served(self):
        for path in ("/", "/server.py", "/cloud_app.py", "/runtime/Skills-Architects/LICENSE", "/%64ashboard.html", "/assets/../dashboard.html"):
            self.assertEqual(self.call(path, auth=True)[0], 404, path)

    def test_origin_and_invalid_body_contract(self):
        self.assertEqual(self.call("/api/v1/study-reviews", review_payload(), auth=True, origin="https://other.example")[0], 403)
        self.assertEqual(self.call("/api/v1/study-reviews", {}, auth=True)[0], 400)

    def test_stateless_cloud_run_never_opens_a_local_or_cloud_archive(self):
        import study_archive
        directory = Path(self.temp.name) / "must-not-be-created"
        with patch.dict(os.environ, {"ARCHIVE_BACKEND": "disabled", "K_SERVICE": "formequa-api", "ARCHIVE_BUCKET": "",
                                    "ARCHIVE_DB_PATH": str(directory / "archive.sqlite3")}), \
                patch.object(study_archive, "cloud_archive", side_effect=AssertionError("Cloud storage must not be opened")), \
                patch.object(study_archive, "_connect", side_effect=AssertionError("SQLite must not be opened")), \
                patch.object(cloud_app.server.Seoul3DRequestHandler, "read_calculation_body", side_effect=AssertionError("Review body must not be parsed")):
            self.app = validator(cloud_app.create_app())
            self.assertEqual(self.call("/api/health")[0], 200)
            self.assertEqual(self.call("/dashboard.html")[0], 401)
            self.assertEqual(self.call("/dashboard.html", auth=True)[0], 200)
            self.assertEqual(self.call("/api/v1/study-reviews", review_payload())[0], 401)
            self.assertEqual(self.call("/api/v1/study-reviews", review_payload(), auth=True)[0], 404)
            self.assertEqual(self.call("/api/v1/study-reviews", {}, auth=True)[0], 404)
            self.assertEqual(json.loads(self.call("/api/v1/studies")[1]), {"studies": [], "total": 0, "nextOffset": None})
            self.assertEqual(self.call("/api/v1/studies/" + "a" * 24 + "/image.png")[0], 404)
            self.assertEqual(self.call("/api/v1/study-reviews/weeks", auth=True)[0], 404)
            self.assertIsNone(study_archive.get_review("a" * 24))
            self.assertEqual(study_archive.list_weeks(), {"weeks": [], "pendingCount": 0})
            self.assertEqual(study_archive.export_recent()["studies"], [])
            self.assertEqual(study_archive.export_week("2026-W43")["studies"], [])
            for operation in (lambda: study_archive.collect(review_payload()),
                              lambda: study_archive.publish_manual("a" * 24, "must-not-read.png"),
                              lambda: study_archive._write_record({"id": "a" * 24})):
                with self.assertRaises(study_archive.CatalogError) as failure:
                    operation()
                self.assertEqual(failure.exception.status, 404)
        self.assertFalse(directory.exists())

    def test_stateless_mode_preserves_old_local_files_and_cloud_fallback_rules(self):
        import study_archive
        existing = Path(self.temp.name) / "existing-local-archive.sqlite3"
        existing.write_bytes(b"pre-existing local archive fixture")
        with patch.dict(os.environ, {"ARCHIVE_BACKEND": "disabled", "K_SERVICE": "formequa-api", "ARCHIVE_DB_PATH": str(existing)}):
            self.assertEqual(study_archive.list_studies()["total"], 0)
            self.assertEqual(existing.read_bytes(), b"pre-existing local archive fixture")
        for backend in ("sqlite", "", "invalid"):
            with patch.dict(os.environ, {"ARCHIVE_BACKEND": backend, "K_SERVICE": "formequa-api"}), self.assertRaises(study_archive.CatalogError):
                cloud_app.create_app()
        with patch.dict(os.environ, {"ARCHIVE_BACKEND": "gcs", "K_SERVICE": "formequa-api", "ARCHIVE_BUCKET": ""}), self.assertRaises(study_archive.CatalogError):
            cloud_app.create_app()
