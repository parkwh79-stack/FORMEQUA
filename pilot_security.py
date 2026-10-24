"""Access controls for pilot routes; client JavaScript is necessarily public."""
import base64
import hmac
import os
import re
import threading
import time
import ipaddress
from collections import OrderedDict
from pathlib import Path
from urllib.parse import unquote, urlparse

PUBLIC_DIR = Path(__file__).resolve().parent
_BUCKETS = OrderedDict()
_LOCK = threading.Lock()
API_SLOTS = threading.BoundedSemaphore(4)
BACKEND_FILES = {"analysis-engine.js", "server.py", "provider_settings.py", "parcel_service.py", "study_catalog.py", "study_archive.py", "study_review_tools.py", "pilot_security.py",
                 "mass-ifc.js", "spatial-navigation.js", "bim-handoff.js", "spatial-review.js"}
ALLOWED_SUFFIXES = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff", ".woff2", ".ico"}


def origin_allowed(headers, port):
    allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
    public = os.environ.get("PUBLIC_ORIGIN", "").rstrip("/")
    if public:
        allowed.add(public)
    origin = headers.get("Origin")
    return (not origin or origin in allowed) and headers.get("Sec-Fetch-Site") != "cross-site"


def authorized(headers):
    password = os.environ.get("PILOT_PASSWORD", "")
    if not password:
        return True  # Local development only; public startup enforces configuration.
    try:
        method, token = headers.get("Authorization", "").split(" ", 1)
        value = base64.b64decode(token, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    return method == "Basic" and hmac.compare_digest(value.encode(), ("formequa:" + password).encode())


def protected_route(path, method="GET"):
    path = path.casefold()
    if path == "/dashboard.html":
        return True
    public_studies = method == "GET" and (path == "/api/v1/studies" or re.fullmatch(r"/api/v1/studies/[0-9a-f]{24}/image\.png", path))
    return path.startswith("/api/") and path != "/api/health" and not public_studies


def permit_rate(ip, category, limit=120):
    now = time.monotonic()
    key = (ip, category)
    with _LOCK:
        start, count = _BUCKETS.pop(key, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        _BUCKETS[key] = (start, count + 1)
        while len(_BUCKETS) > 4096:
            _BUCKETS.popitem(last=False)
        return count < limit


def rate_client(peer, headers):
    trusted = {value.strip() for value in os.environ.get("TRUSTED_PROXY_IPS", "").split(",") if value.strip()}
    if peer in trusted:
        try:
            # Configure the trusted single proxy to overwrite this header.
            return str(ipaddress.ip_address(headers.get("X-Forwarded-For", "").split(",")[-1].strip()))
        except ValueError:
            pass
    return peer


def static_allowed(raw_path):
    path = unquote(urlparse(raw_path).path)
    if path == "/":
        return True
    if path == "/law-evidence/manifest.json":
        # Reviewed, public-law source index used by both browser work surfaces.
        return (PUBLIC_DIR / "law-evidence" / "manifest.json").is_file()
    parts = path.lstrip("/").split("/")
    if any(not p or p.startswith(".") or p in {"..", "docs", "tests", "law-evidence", "__pycache__"} for p in parts):
        return False
    if "\\" in path or "\x00" in path or ":" in path or parts[-1].casefold() in BACKEND_FILES:
        return False
    if len(parts) > 1 and parts[0] not in {"assets", "vendor"}:
        return False
    if Path(path).suffix.lower() not in ALLOWED_SUFFIXES:
        return False
    target = (PUBLIC_DIR / path.lstrip("/")).resolve()
    try:
        target.relative_to(PUBLIC_DIR)
    except ValueError:
        return False
    return target.is_file()


def validate_public_config():
    origin = os.environ.get("PUBLIC_ORIGIN", "")
    host = os.environ.get("BIND_HOST", "127.0.0.1")
    if origin:
        parsed = urlparse(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin without a path.")
    if (origin or host not in {"127.0.0.1", "localhost", "::1"}) and len(os.environ.get("PILOT_PASSWORD", "")) < 16:
        raise ValueError("Public pilot requires PUBLIC_ORIGIN (HTTPS) and a PILOT_PASSWORD of at least 16 characters.")
    if host not in {"127.0.0.1", "localhost", "::1"} and not origin:
        raise ValueError("Public bind requires PUBLIC_ORIGIN.")


def response_headers(path):
    headers = [("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "SAMEORIGIN"),
               ("Referrer-Policy", "same-origin"), ("Permissions-Policy", "camera=(), microphone=(), geolocation=()")]
    if path.startswith(("/api/", "/dashboard")):
        headers += [("Cache-Control", "no-store"), ("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet")]
    headers.append(("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' https://smap.seoul.go.kr; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"))
    return headers
