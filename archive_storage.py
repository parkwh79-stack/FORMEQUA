"""Small GCS object store. Application Default Credentials; never signed URLs."""
import re


class Conflict(Exception):
    """A generation precondition failed; the caller must reread state."""


class StorageUnavailable(Exception):
    pass


class GCSObjectStore:
    def __init__(self, bucket_name):
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", bucket_name or ""):
            raise StorageUnavailable("Invalid private bucket configuration")
        try:
            from google.cloud import storage
            self.bucket = storage.Client().bucket(bucket_name)
            self.bucket.reload(timeout=10, retry=None)
            policy = self.bucket.iam_configuration
            if not policy.uniform_bucket_level_access_enabled or policy.public_access_prevention != "enforced":
                raise StorageUnavailable("Private bucket protections are required")
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable("Private storage connection failed") from None

    def read(self, key, max_bytes):
        from google.api_core.exceptions import NotFound, PreconditionFailed
        blob = self.bucket.blob(key)
        try:
            blob.reload(timeout=10, retry=None)
            if blob.size is None or blob.size > max_bytes:
                raise StorageUnavailable("Object exceeds its allowed size")
            generation = int(blob.generation)
            value = blob.download_as_bytes(if_generation_match=generation, timeout=20, retry=None)
            if len(value) > max_bytes:
                raise StorageUnavailable("Object exceeds its allowed size")
            return value, generation
        except NotFound:
            return None
        except PreconditionFailed:
            raise Conflict() from None
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable("Private storage read failed") from None

    def write(self, key, value, generation=0, content_type="application/json"):
        from google.api_core.exceptions import PreconditionFailed
        blob = self.bucket.blob(key)
        blob.cache_control = "private, no-store"
        try:
            blob.upload_from_string(value, content_type=content_type, if_generation_match=generation,
                                    timeout=20, retry=None)
            return int(blob.generation)
        except PreconditionFailed:
            raise Conflict() from None
        except Exception:
            raise StorageUnavailable("Private storage write failed") from None
