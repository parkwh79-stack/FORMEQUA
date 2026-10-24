"""SDK transport checks: private bucket policy and conditional object writes."""
import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from archive_storage import Conflict, GCSObjectStore, StorageUnavailable

try:
    from google.api_core.exceptions import NotFound, PreconditionFailed
    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False


@unittest.skipUnless(SDK_AVAILABLE, "Install requirements-cloud.txt for SDK transport tests")
class ObjectStoreTests(unittest.TestCase):
    def make(self, **policy):
        bucket = MagicMock()
        bucket.iam_configuration = SimpleNamespace(uniform_bucket_level_access_enabled=True,
                                                   public_access_prevention="enforced")
        for key, value in policy.items():
            setattr(bucket.iam_configuration, key, value)
        client = MagicMock()
        client.bucket.return_value = bucket
        with patch("google.cloud.storage.Client", return_value=client):
            instance = GCSObjectStore("private-test-bucket")
        return instance, bucket

    def test_public_or_acl_enabled_bucket_is_rejected(self):
        for policy in ({"public_access_prevention": "inherited"}, {"uniform_bucket_level_access_enabled": False}):
            with self.assertRaises(StorageUnavailable):
                self.make(**policy)

    def test_read_is_bound_to_generation_and_size(self):
        store, bucket = self.make()
        blob = bucket.blob.return_value
        blob.size, blob.generation = 3, 17
        blob.download_as_bytes.return_value = b"abc"
        self.assertEqual(store.read("records/example.json", 10), (b"abc", 17))
        blob.download_as_bytes.assert_called_once_with(if_generation_match=17, timeout=20, retry=None)
        blob.size = 100
        with self.assertRaises(StorageUnavailable):
            store.read("records/example.json", 10)

    def test_missing_and_changed_objects_are_distinct(self):
        store, bucket = self.make()
        blob = bucket.blob.return_value
        blob.reload.side_effect = NotFound("missing")
        self.assertIsNone(store.read("records/example.json", 10))
        blob.reload.side_effect = PreconditionFailed("changed")
        with self.assertRaises(Conflict):
            store.read("records/example.json", 10)

    def test_write_uses_precondition_and_private_cache_without_public_acl(self):
        store, bucket = self.make()
        blob = bucket.blob.return_value
        blob.generation = 20
        self.assertEqual(store.write("index.json", b"{}", 19), 20)
        blob.upload_from_string.assert_called_once_with(b"{}", content_type="application/json", if_generation_match=19,
                                                       timeout=20, retry=None)
        self.assertEqual(blob.cache_control, "private, no-store")
        self.assertFalse(blob.make_public.called)
        self.assertFalse(blob.generate_signed_url.called)
        blob.upload_from_string.side_effect = PreconditionFailed("changed")
        with self.assertRaises(Conflict):
            store.write("index.json", b"{}", 19)
