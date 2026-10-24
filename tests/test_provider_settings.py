import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from provider_settings import load_settings, SETTINGS_PATH
TEST_TEMP_ROOT = Path(__file__).resolve().parents[2] / ".backups"
TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)


class SettingsTests(unittest.TestCase):
    def test_secret_file_is_outside_web_root(self):
        web_root = Path(__file__).resolve().parents[1]
        self.assertFalse(SETTINGS_PATH.is_relative_to(web_root))

    def test_explicit_env_takes_precedence(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory, patch.dict(os.environ, {"VWORLD_API_KEY": "environment-fixture"}, clear=True):
            self.assertTrue(Path(directory).resolve().is_relative_to(TEST_TEMP_ROOT.resolve()))
            path = Path(directory) / "settings.json"
            path.write_text(json.dumps({"VWORLD_API_KEY": "file-fixture", "VWORLD_DOMAIN": "http://127.0.0.1:8090"}), encoding="utf-8")
            load_settings(path)
            self.assertEqual(os.environ["VWORLD_API_KEY"], "environment-fixture")
            self.assertEqual(os.environ["VWORLD_DOMAIN"], "http://127.0.0.1:8090")

    def test_invalid_file_is_not_copied_to_error(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory, patch.dict(os.environ, {}, clear=True):
            self.assertTrue(Path(directory).resolve().is_relative_to(TEST_TEMP_ROOT.resolve()))
            path = Path(directory) / "settings.json"
            path.write_text('{"unknown_secret":"fixture-secret-never-output"}', encoding="utf-8")
            with self.assertRaises(ValueError) as error:
                load_settings(path)
            self.assertNotIn("fixture-secret-never-output", str(error.exception))
            self.assertNotIn("unknown_secret", os.environ)


if __name__ == "__main__":
    unittest.main()
