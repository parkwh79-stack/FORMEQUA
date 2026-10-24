"""Private review JSON archive and owner-curated images; no generation provider."""
import hashlib
import io
import json
import math
import os
import re
import secrets
import sqlite3
import warnings
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from study_catalog import CatalogError, PROGRAMS

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9), "Asia/Seoul")
MAX_BODY_BYTES = 20 * 1024 * 1024
MAX_TREE_DEPTH = 80
MAX_TREE_NODES = 500_000
MAX_RECORDS = 10_000
MAX_STORAGE_BYTES = 1_073_741_824
MAX_IMAGE_BYTES = 10 * 1024 * 1024
PALETTES = {"limestone", "bronze", "stone", "white", "terracotta"}
FACADES = {"curtain_wall", "brick_rainscreen", "stone_ribbon", "kinetic_louver", "diagrid_biophilic"}
ID = re.compile(r"[0-9a-f]{24}\Z")
CREDENTIAL_KEYS = {"apikey", "api_key", "authorization", "access_token", "refresh_token", "password",
                   "secretkey", "secret_key", "clientsecret", "idtoken", "sessiontoken", "session_token"}
VOLATILE_KEYS = {"capturedAt", "exportedAt", "updatedAt", "generatedAt", "calculatedAt", "snapshotAt", "timestamp", "lastSavedAt", "savedAt", "createdAt"}


def storage_backend():
    backend = os.environ.get("ARCHIVE_BACKEND", "sqlite")
    if backend not in {"sqlite", "gcs", "disabled"} or (os.environ.get("K_SERVICE") and backend not in {"gcs", "disabled"}):
        raise CatalogError("클라우드 실행에는 비공개 영구 보관소 설정이 필요합니다.", 503, "ARCHIVE_CONFIGURATION_REQUIRED")
    if backend == "gcs" and not os.environ.get("ARCHIVE_BUCKET"):
        raise CatalogError("비공개 보관 버킷을 설정해 주세요.", 503, "ARCHIVE_CONFIGURATION_REQUIRED")
    return backend


def require_storage():
    if storage_backend() == "disabled":
        raise CatalogError("검토 기록 저장을 제공하지 않습니다.", 404, "REVIEW_STORAGE_DISABLED")


def cloud_archive():
    import archive_gcs
    return archive_gcs


def database_path():
    return Path(os.environ.get("ARCHIVE_DB_PATH") or ROOT / ".pilot-data" / "study-review" / "archive.sqlite3")


def _now():
    return datetime.now(KST)


def _week(value):
    year, number, _ = value.astimezone(KST).isocalendar()
    return f"{year:04d}-W{number:02d}"


@contextmanager
def _connect():
    require_storage()
    conn = None
    try:
        path = database_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("""CREATE TABLE IF NOT EXISTS study_reviews (
            id TEXT PRIMARY KEY, record TEXT NOT NULL, week TEXT NOT NULL,
            collected_at TEXT NOT NULL, manual_image BLOB, published_at TEXT,
            image_revision INTEGER NOT NULL DEFAULT 3)""")
        if "image_revision" not in {row[1] for row in conn.execute("PRAGMA table_info(study_reviews)")}:
            conn.execute("BEGIN IMMEDIATE")
            if "image_revision" not in {row[1] for row in conn.execute("PRAGMA table_info(study_reviews)")}:
                conn.execute("ALTER TABLE study_reviews ADD COLUMN image_revision INTEGER NOT NULL DEFAULT 3")
            conn.commit()
        with conn:
            yield conn
    except (sqlite3.Error, OSError):
        raise CatalogError("연구 기록 보관소를 잠시 사용할 수 없습니다.", 503, "ARCHIVE_UNAVAILABLE") from None
    finally:
        if conn is not None:
            conn.close()


def _number(value, low, high):
    if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
        raise CatalogError("연구 모형의 수치 범위를 확인해 주세요.")
    return round(value, 3)


def normalize_private_summary(raw):
    fields = {"program", "siteAreaSqm", "farPct", "bcrPct", "floors"}
    if (not isinstance(raw, dict) or set(raw) != fields or not isinstance(raw["program"], str)
            or raw["program"] not in PROGRAMS):
        raise CatalogError("검토 요약에는 용도·면적·용적률·건폐율·층수만 사용할 수 있습니다.")
    area = _number(raw["siteAreaSqm"], 1, 1_000_000)
    far = _number(raw["farPct"], 0, 1500)
    bcr = _number(raw["bcrPct"], 0, 100)
    floors = _number(raw["floors"], 0, 100)
    if int(raw["floors"]) != raw["floors"]:
        raise CatalogError("검토 층수는 정수여야 합니다.")
    return {"program": raw["program"], "siteAreaSqm": max(10, round(area / 10) * 10),
            "farPct": round(far, 1), "bcrPct": round(bcr, 1), "floors": int(floors)}


def normalize_model(raw, floors):
    if not isinstance(raw, dict) or set(raw) != {"plates", "appearance"}:
        raise CatalogError("연구 모형에는 층별 형상과 외관만 사용할 수 있습니다.")
    plates, appearance = raw["plates"], raw["appearance"]
    if not isinstance(plates, list) or len(plates) != floors:
        raise CatalogError("모형의 층수와 층별 형상을 확인해 주세요.")
    if (not isinstance(appearance, dict) or set(appearance) - {"palette", "facade"}
            or "palette" not in appearance or not isinstance(appearance["palette"], str)
            or appearance["palette"] not in PALETTES
            or ("facade" in appearance and (not isinstance(appearance["facade"], str) or appearance["facade"] not in FACADES))):
        raise CatalogError("모형 외관의 형식을 확인해 주세요.")
    result = []
    required = {"level", "width", "depth", "height", "y"}
    allowed = required | {"shiftX", "shiftZ", "courtyard"}
    for plate in plates:
        if not isinstance(plate, dict) or not required <= set(plate) or set(plate) - allowed:
            raise CatalogError("층별 모형의 항목을 확인해 주세요.")
        level = plate["level"]
        if type(level) is not int or not 1 <= level <= 100:
            raise CatalogError("모형 층 번호는 1~100의 정수여야 합니다.")
        courtyard = plate.get("courtyard", False)
        if type(courtyard) is not bool:
            raise CatalogError("중정 여부는 참 또는 거짓이어야 합니다.")
        result.append({"level": level, "width": _number(plate["width"], .1, 2000),
                       "depth": _number(plate["depth"], .1, 2000), "height": _number(plate["height"], .1, 30),
                       "y": _number(plate["y"], .05, 2000), "shiftX": _number(plate.get("shiftX", 0), -2000, 2000),
                       "shiftZ": _number(plate.get("shiftZ", 0), -2000, 2000), "courtyard": courtyard})
    result.sort(key=lambda item: item["level"])
    if len({plate["level"] for plate in result}) != floors:
        raise CatalogError("모형에 중복된 층 번호가 있습니다.")
    return {"plates": result, "appearance": dict(appearance)}


def normalize_site(raw):
    if not isinstance(raw, dict) or not {"parcels"} <= set(raw) or set(raw) - {"parcels", "boundary"}:
        raise CatalogError("비공개 대지에는 필지와 로컬 경계만 사용할 수 있습니다.")
    parcels, boundary = raw["parcels"], raw.get("boundary", [])
    if not isinstance(parcels, list) or not 0 <= len(parcels) <= 5:
        raise CatalogError("비공개 필지는 최대 5개까지 기록할 수 있습니다.")
    cleaned, identities = [], set()
    for parcel in parcels:
        if (not isinstance(parcel, dict) or set(parcel) != {"address", "pnu"}
                or not isinstance(parcel["address"], str) or len(parcel["address"]) > 500
                or any(ord(char) < 32 for char in parcel["address"])
                or not isinstance(parcel["pnu"], str) or (parcel["pnu"] and not re.fullmatch(r"[0-9]{19}", parcel["pnu"]))):
            raise CatalogError("비공개 주소·PNU의 형식을 확인해 주세요.")
        _text(parcel["address"])
        address, pnu = " ".join(parcel["address"].split()), parcel["pnu"]
        if not address and not pnu:
            raise CatalogError("각 필지에는 주소 또는 PNU가 필요합니다.")
        identity = "pnu:" + pnu if pnu else "address:" + address
        if identity in identities:
            raise CatalogError("같은 필지를 중복해 기록할 수 없습니다.")
        identities.add(identity)
        cleaned.append({"address": address, "pnu": pnu})
    if not isinstance(boundary, list) or len(boundary) > 1000:
        raise CatalogError("비공개 대지 경계의 크기를 확인해 주세요.")
    points = []
    for point in boundary:
        if not isinstance(point, dict) or set(point) != {"x", "z"}:
            raise CatalogError("대지 경계에는 로컬 x·z 좌표만 사용할 수 있습니다.")
        points.append({"x": _number(point["x"], -10000, 10000), "z": _number(point["z"], -10000, 10000)})
    return {"parcels": cleaned, "boundary": points}, sorted(identities)


def _encoded(record):
    return json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _text(value):
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise CatalogError("검토 자료의 문자 인코딩을 확인해 주세요.") from None
    return value


def normalize_review_data(raw):
    fields = {"project", "calculations", "floorPlans", "legalEvidence", "siteContext", "runtime"}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise CatalogError("검토 자료의 여섯 항목을 확인해 주세요.")
    count = 0
    def visit(value, depth=0):
        nonlocal count
        count += 1
        if count > MAX_TREE_NODES or depth > MAX_TREE_DEPTH:
            raise CatalogError("검토 자료의 깊이 또는 항목 수가 너무 큽니다.")
        if type(value) is str:
            return _text(value)
        if value is None or type(value) is bool:
            return value
        if type(value) is int:
            if abs(value) > 10 ** 308:
                raise CatalogError("검토 자료에는 유한한 수치만 사용할 수 있습니다.")
            return value
        if type(value) is float:
            if not math.isfinite(value):
                raise CatalogError("검토 자료에는 유한한 수치만 사용할 수 있습니다.")
            return value
        if isinstance(value, list):
            return [visit(item, depth + 1) for item in value]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                if not isinstance(key, str) or key.casefold() in CREDENTIAL_KEYS:
                    raise CatalogError("인증키·비밀번호·접속 토큰은 검토 기록에 저장할 수 없습니다.")
                _text(key)
                result[key] = visit(item, depth + 1)
            return result
        raise CatalogError("검토 자료에는 JSON 값만 사용할 수 있습니다.")
    return visit(raw)


def _identity_review(value):
    if isinstance(value, dict):
        return {key: _identity_review(item) for key, item in value.items() if key not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [_identity_review(item) for item in value]
    return value


def _write_record(record):
    """SQLite is canonical; retrying collection repairs a missing JSON copy."""
    require_storage()
    directory = database_path().parent / "records"
    temporary = directory / f".{record['id']}-{secrets.token_hex(6)}.tmp"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        # A simultaneous manual review may have changed the canonical record
        # after collection committed. Serialize the fresh copy under its lock.
        with _connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT record FROM study_reviews WHERE id=?", (record["id"],)).fetchone()
            if row is None:
                raise CatalogError("기록할 연구를 찾을 수 없습니다.", 404, "REVIEW_NOT_FOUND")
            temporary.write_text(row["record"], encoding="utf-8")
            os.replace(temporary, directory / f"{record['id']}.json")
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise CatalogError("JSON 기록 파일을 저장하지 못했습니다. 다시 시도해 주세요.", 503, "ARCHIVE_FILE_UNAVAILABLE") from None


def collect(payload):
    require_storage()
    if not isinstance(payload, dict) or set(payload) != {"summary", "model", "site", "reviewData", "modelFingerprint"}:
        raise CatalogError("연구 기록에는 요약·모형·비공개 대지만 사용할 수 있습니다.")
    fingerprint = payload["modelFingerprint"]
    if not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        raise CatalogError("모형 식별값을 확인해 주세요.")
    summary = normalize_private_summary(payload["summary"])
    model = normalize_model(payload["model"], summary["floors"])
    site, identities = normalize_site(payload["site"])
    review_data = normalize_review_data(payload["reviewData"])
    identity = _encoded({"summary": summary, "model": model, "siteIdentities": identities,
                         "reviewData": _identity_review(review_data)})
    study_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    now = _now()
    record = {"schemaVersion": 1, "id": study_id, "collectedAt": now.isoformat(timespec="seconds"),
              "summary": summary, "model": model, "site": site, "reviewData": review_data,
              "review": {"status": "pending"}}
    encoded = _encoded(record)
    if len(encoded.encode("utf-8")) > MAX_BODY_BYTES:
        raise CatalogError("검토 JSON은 20MiB 이하로 기록해 주세요.", 413, "REVIEW_TOO_LARGE")
    if storage_backend() == "gcs":
        return cloud_archive().collect(record)
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        previous = conn.execute("SELECT record FROM study_reviews WHERE id=?", (study_id,)).fetchone()
        created = previous is None
        if previous:
            record = json.loads(previous["record"])
        else:
            count, used = conn.execute("SELECT COUNT(*),COALESCE(SUM(2*LENGTH(CAST(record AS BLOB))+COALESCE(LENGTH(manual_image),0)),0) FROM study_reviews").fetchone()
            if count >= MAX_RECORDS or used + 2 * len(encoded.encode("utf-8")) > MAX_STORAGE_BYTES:
                raise CatalogError("연구 기록 보관 한도에 도달했습니다. 분석은 계속 이용할 수 있습니다.", 503, "ARCHIVE_FULL")
            conn.execute("INSERT INTO study_reviews(id,record,week,collected_at) VALUES(?,?,?,?)",
                         (study_id, encoded, _week(now), record["collectedAt"]))
    _write_record(record)
    return {"study": {"id": study_id}, "created": created, "review": {"status": "collected"}}


def get_review(study_id):
    if storage_backend() == "disabled":
        return None
    if not isinstance(study_id, str) or not ID.fullmatch(study_id):
        return None
    if storage_backend() == "gcs":
        return cloud_archive().get_review(study_id)
    with _connect() as conn:
        row = conn.execute("SELECT record FROM study_reviews WHERE id=?", (study_id,)).fetchone()
        return json.loads(row[0]) if row else None


def list_weeks():
    if storage_backend() == "disabled":
        return {"weeks": [], "pendingCount": 0}
    if storage_backend() == "gcs":
        return cloud_archive().list_weeks()
    with _connect() as conn:
        rows = conn.execute("SELECT week,record FROM study_reviews ORDER BY week DESC,collected_at DESC,id DESC").fetchall()
    weeks, total_pending = {}, 0
    for row in rows:
        pending = json.loads(row["record"])["review"]["status"] == "pending"
        item = weeks.setdefault(row["week"], {"week": row["week"], "count": 0, "pendingCount": 0})
        item["count"] += 1
        item["pendingCount"] += int(pending)
        total_pending += int(pending)
    return {"weeks": list(weeks.values()), "pendingCount": total_pending}


def export_week(week):
    if not isinstance(week, str) or not re.fullmatch(r"[0-9]{4}-W[0-9]{2}", week):
        raise CatalogError("주차는 YYYY-Www 형식으로 입력해 주세요.")
    try:
        monday = date.fromisocalendar(int(week[:4]), int(week[6:]), 1)
        start = datetime.combine(monday, time.min, KST)
        end = start + timedelta(days=7)
    except (ValueError, OverflowError):
        raise CatalogError("유효한 연도·주차를 입력해 주세요.") from None
    if storage_backend() == "disabled":
        studies = []
    elif storage_backend() == "gcs":
        studies = cloud_archive().records_between(week=week)
    else:
        with _connect() as conn:
            rows = conn.execute("SELECT record FROM study_reviews WHERE week=? ORDER BY collected_at,id", (week,)).fetchall()
        studies = [json.loads(row[0]) for row in rows]
    return {"schemaVersion": 1, "week": week,
            "period": {"start": start.isoformat(timespec="seconds"), "end": end.isoformat(timespec="seconds"),
                       "timeZone": "Asia/Seoul", "endExclusive": True},
            "studies": studies}


def records_between(start, end):
    if storage_backend() == "disabled":
        return []
    if storage_backend() == "gcs":
        return cloud_archive().records_between(start=start, end=end)
    with _connect() as conn:
        rows = conn.execute("SELECT record FROM study_reviews WHERE collected_at>=? AND collected_at<? ORDER BY collected_at,id",
                            (start, end)).fetchall()
    return [json.loads(row[0]) for row in rows]


def export_recent(days=7, now=None):
    if type(days) is not int or not 1 <= days <= 366:
        raise CatalogError("최근 검토 기간은 1~366일로 입력해 주세요.")
    if now is None:
        end = _now()
    elif isinstance(now, datetime) and now.tzinfo is not None:
        end = now.astimezone(KST)
    else:
        raise CatalogError("기준 시각에는 시간대가 필요합니다.")
    start = end - timedelta(days=days)
    studies = records_between(start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"))
    return {"schemaVersion": 1, "period": {"start": start.isoformat(timespec="seconds"),
            "end": end.isoformat(timespec="seconds"), "timeZone": "Asia/Seoul", "endExclusive": True},
            "count": len(studies), "studies": studies}


def _clean_manual_image(image_path):
    try:
        path = Path(image_path)
        if path.stat().st_size > MAX_IMAGE_BYTES:
            raise ValueError()
        raw = path.read_bytes()
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if (source.format not in {"PNG", "JPEG", "WEBP"} or getattr(source, "n_frames", 1) != 1
                        or not (320 <= source.width <= 8192 and 240 <= source.height <= 8192)
                        or source.width * source.height > 16_000_000):
                    raise ValueError()
                source.load()
                image = Image.new("RGB", source.size, "#eeece7")
                if source.mode == "RGBA":
                    image.paste(source, mask=source.getchannel("A"))
                else:
                    image.paste(source.convert("RGB"))
                image.thumbnail((1600, 1200))
                output = io.BytesIO()
                image.save(output, "PNG", optimize=True)
                return output.getvalue()
    except (TypeError, ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise CatalogError("수동 등록 이미지는 10MB 이하의 PNG·JPEG·WebP 파일이어야 합니다.") from None


def _public(row):
    record = json.loads(row["record"])
    program = record["summary"]["program"]
    return {"id": row["id"], "program": program, "title": f"{PROGRAMS[program]} 공간 연구",
            "createdAt": row["published_at"], "source": "pilot-study", "imageKind": "ai-concept",
            "renderVersion": row["image_revision"], "curation": "manual-reviewed",
            "imageUrl": f"/api/v1/studies/{row['id']}/image.png",
            "disclaimer": "수동 선정한 건축 개념 이미지 · 실제 시공 사진이 아닙니다"}


def publish_manual(study_id, image_path):
    """Owner command only: server routes never accept an image path or image upload."""
    require_storage()
    if not isinstance(study_id, str) or not ID.fullmatch(study_id):
        raise CatalogError("연구 식별값을 확인해 주세요.")
    png = _clean_manual_image(image_path)
    if storage_backend() == "gcs":
        return cloud_archive().publish_manual(study_id, png)
    now = _now().isoformat(timespec="seconds")
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM study_reviews WHERE id=?", (study_id,)).fetchone()
        if row is None:
            raise CatalogError("등록할 연구 기록을 찾을 수 없습니다.", 404, "REVIEW_NOT_FOUND")
        revision = row["image_revision"] + 1 if row["manual_image"] is not None else 3
        # The public gallery accepts versions 3..100. Refuse an update rather
        # than reuse the same image cache key after this exceptional limit.
        if revision > 100:
            raise CatalogError("이미지 갱신 한도에 도달했습니다. 새 연구 기록으로 등록해 주세요.", 409, "IMAGE_REVISION_LIMIT")
        record = json.loads(row["record"])
        record["review"] = {"status": "reviewed", "reviewedAt": now, "imageRevision": revision}
        encoded = _encoded(record)
        used = conn.execute("SELECT COALESCE(SUM(2*LENGTH(CAST(record AS BLOB))+COALESCE(LENGTH(manual_image),0)),0) FROM study_reviews").fetchone()[0]
        old_bytes = 2 * len(row["record"].encode("utf-8")) + len(row["manual_image"] or b"")
        if used - old_bytes + 2 * len(encoded.encode("utf-8")) + len(png) > MAX_STORAGE_BYTES:
            raise CatalogError("연구 기록 보관 한도에 도달했습니다.", 503, "ARCHIVE_FULL")
        conn.execute("UPDATE study_reviews SET record=?,manual_image=?,published_at=?,image_revision=? WHERE id=?", (encoded, png, now, revision, study_id))
        public = _public(conn.execute("SELECT id,record,published_at,image_revision FROM study_reviews WHERE id=?", (study_id,)).fetchone())
    _write_record(record)
    return public


def list_studies(limit=60, offset=0):
    if storage_backend() == "disabled":
        return {"studies": [], "total": 0, "nextOffset": None}
    try:
        limit, offset = min(60, max(1, int(limit))), max(0, int(offset))
        if offset > 2**63 - 1:
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        raise CatalogError("목록 범위를 확인해 주세요.") from None
    if storage_backend() == "gcs":
        return cloud_archive().list_studies(limit, offset)
    with _connect() as conn:
        rows = conn.execute("SELECT id,record,published_at,image_revision FROM study_reviews WHERE manual_image IS NOT NULL AND published_at IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM study_reviews WHERE manual_image IS NOT NULL AND published_at IS NOT NULL").fetchone()[0]
    return {"studies": [_public(row) for row in rows], "total": total,
            "nextOffset": offset + len(rows) if offset + len(rows) < total else None}


def get_image(study_id):
    if storage_backend() == "disabled":
        return None
    if not isinstance(study_id, str) or not ID.fullmatch(study_id):
        return None
    if storage_backend() == "gcs":
        return cloud_archive().get_image(study_id)
    with _connect() as conn:
        row = conn.execute("SELECT manual_image FROM study_reviews WHERE id=? AND published_at IS NOT NULL", (study_id,)).fetchone()
        return bytes(row[0]) if row and row[0] else None
