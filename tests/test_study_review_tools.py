"""Weekly export boundaries and retained project extraction, using temporary records."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import study_archive as archive
import study_review_tools as tools
from test_study_archive import sample


class WeeklyReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ARCHIVE_DB_PATH": str(Path(self.tmp.name) / "archive.sqlite3")})
        self.env.start()
        self.end = datetime(2026, 10, 28, 9, 0, tzinfo=archive.KST)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def collect(self, number, when):
        with patch.object(archive, "_now", return_value=when):
            return archive.collect(sample(number))

    def report(self, now, **options):
        with patch.object(tools, "datetime", wraps=datetime) as clock:
            clock.now.return_value = now
            return tools.weekly_report(**options)

    def test_first_week_private_contents_and_console_summary(self):
        self.collect(1, self.end - timedelta(days=6))
        self.collect(2, self.end - timedelta(days=8))
        result = self.report(self.end)
        self.assertEqual(result["count"], 1)
        self.assertNotIn("studies", result)
        report = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
        self.assertEqual(report["studies"][0]["reviewData"]["calculations"]["totalCost"], 12345678)
        self.assertIn("비공개 주소", report["studies"][0]["site"]["parcels"][0]["address"])
        self.assertEqual(archive.list_studies()["total"], 0)

    def test_missed_week_uses_previous_cursor_without_gap_or_duplicates(self):
        self.collect(1, self.end - timedelta(days=1))
        first = self.report(self.end)
        self.collect(2, self.end + timedelta(days=2))
        second = self.report(self.end + timedelta(days=16))
        self.assertEqual(first["count"], 1)
        self.assertEqual(second["count"], 1)
        self.assertEqual(second["period"]["start"], self.end.isoformat(timespec="seconds"))
        self.assertEqual(self.report(self.end + timedelta(days=17))["count"], 0)

    def test_preview_does_not_advance_notification_cursor(self):
        self.collect(1, self.end - timedelta(days=1))
        preview = self.report(self.end, advance=False)
        self.assertEqual(preview["count"], 1)
        self.assertFalse((Path(self.tmp.name) / "weekly-report-state.json").exists())
        self.assertEqual(self.report(self.end + timedelta(hours=1))["count"], 1)

    def test_exact_end_is_retained_for_the_next_period(self):
        self.collect(1, self.end)
        self.assertEqual(self.report(self.end)["count"], 0)
        self.assertEqual(self.report(self.end + timedelta(seconds=1))["count"], 1)


if __name__ == "__main__":
    unittest.main()
