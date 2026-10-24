"""Persistent, bounded anonymous studies; no project inputs or parcel identifiers."""
import base64
import binascii
import hashlib
import io
import json
import math
import os
import sqlite3
import warnings
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError

PROGRAMS = {"office": "오피스", "officetel": "오피스텔", "hotel": "호텔", "housing": "주거",
            "living": "리빙", "knowledge": "업무공간", "retail": "근린생활", "sales": "판매시설"}
MAX_IMAGE_BYTES = 1_500_000
MAX_BODY_BYTES = 2_100_000
MAX_STUDIES = 10_000
MAX_TOTAL_IMAGE_BYTES = 1_073_741_824
MIN_PUBLIC_RENDER_VERSION = 2
DISCLAIMER = "익명 자동 생성 개념 연구 · 인허가·구조·투자 적합성 미확정"


class CatalogError(ValueError):
    def __init__(self, message, status=400, code="INVALID_STUDY"):
        super().__init__(message)
        self.status, self.code = status, code


def database_path():
    return Path(os.environ.get("STUDIES_DB_PATH") or
                Path(__file__).resolve().parent.parent / ".pilot-data" / "studies.sqlite3")


def storage_limits():
    """Deployment can increase storage without silently making disk use unbounded."""
    def setting(name, default, maximum):
        try:
            return min(maximum, max(1, int(os.environ.get(name, default))))
        except (TypeError, ValueError):
            return default
    return (setting("STUDIES_MAX_RECORDS", MAX_STUDIES, 1_000_000),
            setting("STUDIES_MAX_IMAGE_BYTES", MAX_TOTAL_IMAGE_BYTES, 107_374_182_400))


def normalize_summary(raw):
    fields = {"program", "siteAreaSqm", "farPct", "bcrPct", "floors"}
    if (not isinstance(raw, dict) or set(raw) != fields or not isinstance(raw["program"], str)
            or raw["program"] not in PROGRAMS):
        raise CatalogError("공개 요약에는 용도·면적·용적률·건폐율·층수만 사용할 수 있습니다.")
    limits = {"siteAreaSqm": (1, 1000000), "farPct": (0.01, 1500), "bcrPct": (0.01, 100), "floors": (1, 100)}
    for key, (low, high) in limits.items():
        value = raw[key]
        if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
            raise CatalogError("공개 요약의 수치 범위를 확인해 주세요.")
    if int(raw["floors"]) != raw["floors"]:
        raise CatalogError("층수는 정수여야 합니다.")
    return {"program": raw["program"], "siteAreaSqm": max(10, round(raw["siteAreaSqm"] / 10) * 10),
            "farPct": round(raw["farPct"], 1), "bcrPct": round(raw["bcrPct"], 1), "floors": int(raw["floors"])}


def clean_image(value):
    prefix = "data:image/png;base64,"
    if not isinstance(value, str) or not value.startswith(prefix) or len(value) > MAX_IMAGE_BYTES * 4 // 3 + 30:
        raise CatalogError("크기 제한 안의 PNG 모형 이미지가 필요합니다.")
    try:
        raw = base64.b64decode(value[len(prefix):], validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise CatalogError("모형 이미지 용량이 너무 큽니다.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format != "PNG" or source.n_frames != 1 or not (320 <= source.width <= 1600 and 240 <= source.height <= 1200):
                    raise CatalogError("모형 이미지의 형식과 해상도를 확인해 주세요.")
                source.load()
                # Rebuild pixels in a new image: never retain text/EXIF/ICC chunks.
                image = Image.new("RGB", source.size, "#eeeae2")
                if source.mode == "RGBA":
                    image.paste(source, mask=source.getchannel("A"))
                else:
                    image.paste(source.convert("RGB"))
                image.thumbnail((1200, 900))
                output = io.BytesIO()
                image.save(output, "PNG", optimize=True)
                return output.getvalue()
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning, ValueError) as exc:
        if isinstance(exc, CatalogError):
            raise
        raise CatalogError("모형 이미지를 읽을 수 없습니다.") from None


@contextmanager
def _connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=3)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS studies (id TEXT PRIMARY KEY, summary TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT NOT NULL, model_fingerprint TEXT, render_version INTEGER NOT NULL DEFAULT 1)")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(studies)")}
        if not {"model_fingerprint", "render_version"} <= columns:
            # Recheck after taking the writer lock: simultaneous first requests can migrate.
            conn.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in conn.execute("PRAGMA table_info(studies)")}
            if "model_fingerprint" not in columns:
                conn.execute("ALTER TABLE studies ADD COLUMN model_fingerprint TEXT")
            if "render_version" not in columns:
                conn.execute("ALTER TABLE studies ADD COLUMN render_version INTEGER NOT NULL DEFAULT 1")
            conn.commit()
        with conn:
            yield conn
    finally:
        conn.close()


def _public(row):
    study_id, summary, created_at, render_version = row
    value = json.loads(summary)
    return {"id": study_id, "title": f"{PROGRAMS[value['program']]} · {value['floors']}층 연구", **value,
            "createdAt": created_at, "imageUrl": f"/api/v1/studies/{study_id}/image.png",
            "source": "pilot-study", "renderVersion": render_version, "disclaimer": DISCLAIMER}


def publish(payload):
    if (not isinstance(payload, dict) or not {"summary", "imageDataUrl"} <= set(payload)
            or set(payload) - {"summary", "imageDataUrl", "modelFingerprint", "renderVersion"}):
        raise CatalogError("익명 요약과 모형 이미지만 게시할 수 있습니다.")
    fingerprint = payload.get("modelFingerprint")
    if fingerprint is not None and (not isinstance(fingerprint, str) or len(fingerprint) != 64
                                    or any(c not in "0123456789abcdef" for c in fingerprint)):
        raise CatalogError("익명 모형 식별값의 형식을 확인해 주세요.")
    render_version = payload.get("renderVersion", 1)
    if type(render_version) is not int or not 1 <= render_version <= 100:
        raise CatalogError("모형 이미지 버전을 확인해 주세요.")
    summary = normalize_summary(payload["summary"])
    png = clean_image(payload["imageDataUrl"])
    encoded = json.dumps(summary, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    identity = fingerprint.encode("ascii") if fingerprint is not None else png
    study_id = hashlib.sha256(encoded.encode("utf-8") + identity).hexdigest()[:24]
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        with _connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            old = conn.execute("SELECT id, summary, created_at, render_version FROM studies WHERE id=?", (study_id,)).fetchone()
            if old:
                if fingerprint is not None and render_version > old[3]:
                    _replace_image(conn, study_id, png, render_version)
                    old = (*old[:3], render_version)
                return {"study": _public(old), "created": False}
            count, total_bytes = conn.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(image)),0) FROM studies").fetchone()
            max_records, max_bytes = storage_limits()
            if count >= max_records or total_bytes + len(png) > max_bytes:
                raise CatalogError("공개 연구 보관 한도에 도달했습니다. 분석은 계속 이용할 수 있습니다.", 503, "CATALOG_FULL")
            conn.execute("INSERT INTO studies (id,summary,image,created_at,model_fingerprint,render_version) VALUES (?,?,?,?,?,?)", (study_id, encoded, png, created_at, fingerprint, render_version))
        return {"study": _public((study_id, encoded, created_at, render_version)), "created": True}
    except (sqlite3.Error, OSError):
        raise CatalogError("연구 보관소를 잠시 사용할 수 없습니다.", 503, "CATALOG_UNAVAILABLE") from None


def list_studies(limit=60, offset=0, *, include_legacy=False):
    try:
        limit, offset = min(60, max(1, int(limit))), max(0, int(offset))
        if offset > 2**63 - 1:
            raise ValueError("Offset exceeds database integer range")
    except (ValueError, TypeError, OverflowError):
        raise CatalogError("연구 목록의 범위를 확인해 주세요.") from None
    try:
        with _connect() as conn:
            minimum = 1 if include_legacy else MIN_PUBLIC_RENDER_VERSION
            rows = conn.execute("SELECT id,summary,created_at,render_version FROM studies WHERE render_version>=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (minimum, limit, offset)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM studies WHERE render_version>=?", (minimum,)).fetchone()[0]
        return {"studies": [_public(row) for row in rows], "total": total,
                "nextOffset": offset + len(rows) if offset + len(rows) < total else None}
    except (sqlite3.Error, OSError):
        raise CatalogError("연구 목록을 잠시 사용할 수 없습니다.", 503, "CATALOG_UNAVAILABLE") from None


def _replace_image(conn, study_id, png, render_version):
    old = conn.execute("SELECT LENGTH(image) FROM studies WHERE id=?", (study_id,)).fetchone()
    if old is None:
        return False
    total = conn.execute("SELECT COALESCE(SUM(LENGTH(image)),0) FROM studies").fetchone()[0]
    if total - old[0] + len(png) > storage_limits()[1]:
        raise CatalogError("공개 연구 보관 한도에 도달했습니다. 분석은 계속 이용할 수 있습니다.", 503, "CATALOG_FULL")
    conn.execute("UPDATE studies SET image=?,render_version=? WHERE id=?", (png, render_version, study_id))
    return True


def replace_image(study_id, image_data_url, render_version=2):
    """Local maintenance only; no HTTP route exposes this operation."""
    if not isinstance(study_id, str) or len(study_id) != 24 or any(c not in "0123456789abcdef" for c in study_id):
        raise CatalogError("연구 식별값을 확인해 주세요.")
    if type(render_version) is not int or not MIN_PUBLIC_RENDER_VERSION <= render_version <= 100:
        raise CatalogError("모형 이미지 버전을 확인해 주세요.")
    png = clean_image(image_data_url)
    try:
        with _connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            old = conn.execute("SELECT render_version FROM studies WHERE id=?", (study_id,)).fetchone()
            if old is None:
                return False
            if render_version < old[0]:
                raise CatalogError("기존 모형보다 이전 버전으로 변경할 수 없습니다.")
            return _replace_image(conn, study_id, png, render_version)
    except (sqlite3.Error, OSError):
        raise CatalogError("연구 보관소를 잠시 사용할 수 없습니다.", 503, "CATALOG_UNAVAILABLE") from None


def get_image(study_id):
    if len(study_id) != 24 or any(c not in "0123456789abcdef" for c in study_id):
        return None
    try:
        with _connect() as conn:
            row = conn.execute("SELECT image FROM studies WHERE id=?", (study_id,)).fetchone()
        return row[0] if row else None
    except (sqlite3.Error, OSError):
        raise CatalogError("모형 이미지를 잠시 사용할 수 없습니다.", 503, "CATALOG_UNAVAILABLE") from None
