"""WSGI entry point for Gunicorn; share the existing validated route handlers.

Gunicorn parses and bounds HTTP. This adapter invokes application routes directly;
it does not open a socket or run Python's development HTTP server in Cloud Run.
Only API routes, robots.txt and the password-protected dashboard are served here.
"""
import io
from email.message import Message
from http import HTTPStatus
from types import SimpleNamespace
from urllib.parse import urlsplit

import pilot_security
import server
import study_archive


class RouteContext(server.Seoul3DRequestHandler):
    def __init__(self, environ):
        self.command = environ["REQUEST_METHOD"]
        self.path = environ.get("RAW_URI") or environ.get("REQUEST_URI") or environ.get("PATH_INFO", "/")
        if "?" not in self.path and environ.get("QUERY_STRING"):
            self.path += "?" + environ["QUERY_STRING"]
        self.headers = Message()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                self.headers[key[5:].replace("_", "-")] = value
        for key in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            if environ.get(key):
                self.headers[key.replace("_", "-")] = environ[key]
        self.rfile = environ["wsgi.input"]
        self.wfile = io.BytesIO()
        self.connection = SimpleNamespace(settimeout=lambda _: None)
        self.server = SimpleNamespace(server_address=("0.0.0.0", server.PORT))
        self.client_address = (environ.get("REMOTE_ADDR", "unknown"), 0)
        self.directory = str(server.WEB_DIR)
        self.request_version = "HTTP/1.1"
        self.requestline = self.command
        self.close_connection = False
        self.status = 500
        self.response_headers = []

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, keyword, value):
        if keyword.casefold() not in {"connection", "transfer-encoding"}:
            self.response_headers.append((keyword, str(value)))

    def end_headers(self):
        for name, value in pilot_security.response_headers(self.path):
            self.send_header(name, value)

    def log_request(self, *args):
        pass


def create_app(validate=True):
    if validate:
        pilot_security.validate_public_config()
        archive_backend = study_archive.storage_backend()
        if archive_backend == "gcs":
            # Refuse a revision with a missing/unprotected/inaccessible bucket.
            study_archive.cloud_archive().store()
        # An explicit disabled backend serves calculations without recording
        # reviews. Cloud Run still refuses an implicit SQLite fallback.
        if not all(path.is_file() for path in (server.LAW_SCRIPT, server.AREA_SCRIPT, server.EGRESS_SCRIPT,
                                               server.COST_SCRIPT, server.FACADE_SCRIPT, server.UVAL_SCRIPT, server.ENERGY_SCRIPT)):
            raise ValueError("The bundled reference calculators are incomplete.")

    def application(environ, start_response):
        request = RouteContext(environ)
        path = urlsplit(request.path).path
        if path != "/dashboard.html" and path != "/robots.txt" and not path.startswith("/api/"):
            request.send_error(404)
        elif request.command not in {"GET", "HEAD", "POST", "OPTIONS"}:
            request.send_error(405)
        else:
            try:
                getattr(request, "do_" + request.command)()
            except Exception:
                # A diagnostic must never dump a review body or provider URL.
                request.response_headers = []
                request.wfile = io.BytesIO()
                request.send_json({"error": {"code": "INTERNAL_ERROR", "message": "요청을 처리하지 못했습니다."}}, 500)
        body = b"" if request.command == "HEAD" else request.wfile.getvalue()
        if not any(name.casefold() == "content-length" for name, _ in request.response_headers):
            request.send_header("Content-Length", len(body))
        if request.status not in {204, 304} and not any(name.casefold() == "content-type" for name, _ in request.response_headers):
            request.send_header("Content-Type", "text/plain; charset=utf-8")
        status = f"{request.status} {HTTPStatus(request.status).phrase}"
        start_response(status, request.response_headers)
        return [body]
    return application
