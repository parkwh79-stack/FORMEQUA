"""Durable private review archive with generation-checked index updates.

Full JSON objects are immutable. Index reservations count towards the quota even
if an upload fails; a duplicate submission repairs the same reserved record.
Publication is an owner CLI operation and never an HTTP write route.
"""
import copy
import json
import os
from functools import lru_cache

from archive_storage import Conflict, GCSObjectStore, StorageUnavailable

INDEX_MAX_BYTES = 8 * 1024 * 1024
MAX_CAS_ATTEMPTS = 10


def _archive():
    import study_archive
    return study_archive


@lru_cache(maxsize=4)
def _store_for(bucket):
    return GCSObjectStore(bucket)


def store():
    return _store_for(os.environ.get("ARCHIVE_BUCKET", ""))


def key(path):
    return "formequa/v1/" + path


def _failure():
    return _archive().CatalogError("비공개 연구 보관소에 연결하지 못했습니다. 다시 시도해 주세요.", 503, "ARCHIVE_UNAVAILABLE")


def _read(path, limit):
    for _ in range(MAX_CAS_ATTEMPTS):
        try:
            return store().read(key(path), limit)
        except Conflict:
            continue
        except StorageUnavailable:
            raise _failure() from None
    raise _failure()


def _index():
    value = _read("index.json", INDEX_MAX_BYTES)
    if value is None:
        return {"schemaVersion": 1, "usedBytes": 0, "entries": {}}, 0
    try:
        index = json.loads(value[0])
        if index["schemaVersion"] != 1 or not isinstance(index["entries"], dict) or type(index["usedBytes"]) is not int:
            raise ValueError()
        return index, value[1]
    except (ValueError, KeyError, TypeError):
        raise _failure() from None


def _update(change):
    for _ in range(MAX_CAS_ATTEMPTS):
        index, generation = _index()
        result, changed = change(index)
        if not changed:
            return result
        body = _archive()._encoded(index).encode("utf-8")
        if len(body) > INDEX_MAX_BYTES:
            raise _archive().CatalogError("연구 기록 목록의 보관 한도에 도달했습니다.", 503, "ARCHIVE_FULL")
        try:
            store().write(key("index.json"), body, generation)
            return result
        except Conflict:
            continue
        except StorageUnavailable:
            raise _failure() from None
    raise _archive().CatalogError("동시에 기록 중입니다. 잠시 후 다시 시도해 주세요.", 503, "ARCHIVE_BUSY")


def _write_once(path, value, content_type="application/json"):
    try:
        store().write(key(path), value, 0, content_type)
    except Conflict:
        pass  # Immutable object already uploaded by this or another request.
    except StorageUnavailable:
        raise _failure() from None


def collect(record):
    archive = _archive()
    study_id = record["id"]
    body = archive._encoded(record).encode("utf-8")

    def reserve(index):
        previous = index["entries"].get(study_id)
        if previous:
            extra = max(0, len(body) - previous["bytes"]) if not previous["ready"] else 0
            if index["usedBytes"] + extra > archive.MAX_STORAGE_BYTES:
                raise archive.CatalogError("연구 기록 보관 한도에 도달했습니다.", 503, "ARCHIVE_FULL")
            previous["bytes"] += extra
            index["usedBytes"] += extra
            return (copy.deepcopy(previous), False), bool(extra)
        if len(index["entries"]) >= archive.MAX_RECORDS or index["usedBytes"] + len(body) > archive.MAX_STORAGE_BYTES:
            raise archive.CatalogError("연구 기록 보관 한도에 도달했습니다. 분석은 계속 이용할 수 있습니다.", 503, "ARCHIVE_FULL")
        entry = {"collectedAt": record["collectedAt"], "week": archive._week(archive.datetime.fromisoformat(record["collectedAt"])),
                 "bytes": len(body), "ready": False, "publication": None}
        index["entries"][study_id] = entry
        index["usedBytes"] += len(body)
        return (copy.deepcopy(entry), True), True

    entry, created = _update(reserve)
    if not entry["ready"]:
        record = copy.deepcopy(record)
        record["collectedAt"] = entry["collectedAt"]
        body = archive._encoded(record).encode("utf-8")
        _write_once(f"records/{study_id}.json", body)
        # Never report success for a reservation without a durable JSON object.
        saved = _read(f"records/{study_id}.json", archive.MAX_BODY_BYTES)
        if saved is None or json.loads(saved[0])["id"] != study_id:
            raise _failure()
        def finish(index):
            item = index["entries"][study_id]
            changed = not item["ready"]
            item["ready"] = True
            return None, changed
        _update(finish)
    return {"study": {"id": study_id}, "created": created, "review": {"status": "collected"}}


def _record(study_id, entry):
    value = _read(f"records/{study_id}.json", _archive().MAX_BODY_BYTES)
    if value is None:
        raise _failure()
    try:
        record = json.loads(value[0])
        if record["id"] != study_id:
            raise ValueError()
        publication = entry.get("publication")
        if publication:
            record["review"] = {"status": "reviewed", "reviewedAt": publication["publishedAt"], "imageRevision": publication["revision"]}
        return record
    except (ValueError, KeyError, TypeError):
        raise _failure() from None


def get_review(study_id):
    index, _ = _index()
    entry = index["entries"].get(study_id)
    return _record(study_id, entry) if entry and entry["ready"] else None


def list_weeks():
    index, _ = _index()
    weeks, pending = {}, 0
    for entry in sorted(index["entries"].values(), key=lambda item: item["week"], reverse=True):
        if not entry["ready"]:
            continue
        item = weeks.setdefault(entry["week"], {"week": entry["week"], "count": 0, "pendingCount": 0})
        item["count"] += 1
        item["pendingCount"] += int(not entry["publication"])
        pending += int(not entry["publication"])
    return {"weeks": list(weeks.values()), "pendingCount": pending}


def records_between(start=None, end=None, week=None):
    index, _ = _index()
    entries = sorted(index["entries"].items(), key=lambda item: (item[1]["collectedAt"], item[0]))
    return [_record(study_id, entry) for study_id, entry in entries if entry["ready"]
            and (week is None or entry["week"] == week)
            and (start is None or entry["collectedAt"] >= start)
            and (end is None or entry["collectedAt"] < end)]


def _public(study_id, publication):
    archive = _archive()
    # Build from a fixed safe schema; never serialize an index or full record.
    return archive._public({"id": study_id, "record": archive._encoded({"summary": {"program": publication["program"]}}),
                            "published_at": publication["publishedAt"], "image_revision": publication["revision"]})


def publish_manual(study_id, png):
    import hashlib
    archive = _archive()
    index, _ = _index()
    entry = index["entries"].get(study_id)
    if not entry or not entry["ready"]:
        raise archive.CatalogError("등록할 연구 기록을 찾을 수 없습니다.", 404, "REVIEW_NOT_FOUND")
    record = _record(study_id, entry)
    image_path = f"images/{study_id}/{hashlib.sha256(png).hexdigest()}.png"
    now = archive._now().isoformat(timespec="seconds")

    def reserve(index):
        item = index["entries"][study_id]
        previous = item.get("publication")
        revision = previous["revision"] + 1 if previous else 3
        if revision > 100:
            raise archive.CatalogError("이미지 갱신 한도에 도달했습니다.", 409, "IMAGE_REVISION_LIMIT")
        # Count retained historical image objects as well as the current one.
        known = item.setdefault("imageObjects", {})
        size = 0 if image_path in known else len(png)
        if index["usedBytes"] + size > archive.MAX_STORAGE_BYTES:
            raise archive.CatalogError("연구 기록 보관 한도에 도달했습니다.", 503, "ARCHIVE_FULL")
        known[image_path] = len(png)
        index["usedBytes"] += size
        return None, bool(size)
    _update(reserve)
    _write_once(image_path, png, "image/png")
    def publish(index):
        item = index["entries"][study_id]
        previous = item.get("publication")
        revision = previous["revision"] + 1 if previous else 3
        if revision > 100:
            raise archive.CatalogError("이미지 갱신 한도에 도달했습니다.", 409, "IMAGE_REVISION_LIMIT")
        publication = {"revision": revision, "publishedAt": now, "program": record["summary"]["program"], "imageKey": image_path}
        item["publication"] = publication
        return _public(study_id, publication), True
    return _update(publish)


def list_studies(limit, offset):
    index, _ = _index()
    rows = [(study_id, entry["publication"]) for study_id, entry in index["entries"].items() if entry["ready"] and entry["publication"]]
    rows.sort(key=lambda item: (item[1]["publishedAt"], item[0]), reverse=True)
    selected = rows[offset:offset + limit]
    return {"studies": [_public(study_id, publication) for study_id, publication in selected], "total": len(rows),
            "nextOffset": offset + len(selected) if offset + len(selected) < len(rows) else None}


def get_image(study_id):
    index, _ = _index()
    entry = index["entries"].get(study_id)
    publication = entry.get("publication") if entry and entry["ready"] else None
    if not publication:
        return None
    value = _read(publication["imageKey"], _archive().MAX_IMAGE_BYTES)
    if value is None:
        raise _failure()
    return value[0]
