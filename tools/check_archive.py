"""Read-only connection check; no record, address, PNU or credential output."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import study_archive

if __name__ == "__main__":
    try:
        if study_archive.storage_backend() != "gcs":
            raise ValueError()
        study_archive.cloud_archive().store()
        result = study_archive.list_weeks()
        print(json.dumps({"backend": "gcs", "privateBucketVerified": True,
                          "weeks": len(result["weeks"]), "pendingCount": result["pendingCount"]}))
    except Exception:
        print(json.dumps({"backend": "gcs", "connected": False, "error": "Check ADC, private bucket settings and runtime permissions."}))
        raise SystemExit(1)
