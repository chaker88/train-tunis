import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import validate_alerts as va  # noqa: E402

DEFAULT = {
    "message": {"severity": "info", "lines": ["all"], "ar": "رحلة سعيدة 🚆", "en": "Have a nice trip 🚆"},
    "scheduled": [],
}
PLANNED = {"severity": "warning", "lines": ["D"], "start": "2026-11-02T22:00", "end": "2026-11-03T05:00",
           "ar": "أشغال صيانة: لا قطارات بعد الساعة 22:00.", "en": "Maintenance works: no trains after 22:00."}


class ValidateAlertsTest(unittest.TestCase):
    def test_default_is_valid(self):
        self.assertEqual(va.validate_alerts(DEFAULT), [])

    def test_live_files_are_valid(self):
        with redirect_stdout(io.StringIO()):
            self.assertTrue(va.run())

    def test_critical_and_scheduled_are_valid(self):
        data = copy.deepcopy(DEFAULT)
        data["message"].update(severity="critical", lines=["A"])
        data["scheduled"].append(PLANNED)
        self.assertEqual(va.validate_alerts(data), [])

    def test_missing_arabic(self):
        data = copy.deepcopy(DEFAULT)
        del data["message"]["ar"]
        errors = va.validate_alerts(data)
        self.assertEqual(len(errors), 1)
        self.assertIn('"ar"', errors[0])

    def test_empty_english(self):
        data = copy.deepcopy(DEFAULT)
        data["message"]["en"] = "  "
        self.assertIn('"en"', va.validate_alerts(data)[0])

    def test_bad_severity(self):
        data = copy.deepcopy(DEFAULT)
        data["message"]["severity"] = "urgent"
        errors = va.validate_alerts(data)
        self.assertEqual(len(errors), 1)
        self.assertIn("urgent", errors[0])

    def test_bad_line(self):
        data = copy.deepcopy(DEFAULT)
        data["message"]["lines"] = ["B"]
        self.assertIn('"lines"', va.validate_alerts(data)[0])

    def test_start_after_end(self):
        data = copy.deepcopy(DEFAULT)
        data["scheduled"].append({**PLANNED, "start": "2026-11-03T06:00"})
        errors = va.validate_alerts(data)
        self.assertEqual(len(errors), 1)
        self.assertIn("must be before", errors[0])

    def test_bad_datetime_format(self):
        data = copy.deepcopy(DEFAULT)
        data["scheduled"].append({**PLANNED, "start": "2026-11-02 22:00"})
        self.assertIn('"start"', va.validate_alerts(data)[0])

    def test_invalid_json_explained(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "alerts.json"
            path.write_text('{"message": {"severity": "info" "lines": ["all"]}}', encoding="utf-8")
            data, errors = va.load_json(path)
            self.assertIsNone(data)
            self.assertIn("missing comma", errors[0])

    def test_overrides(self):
        good = {"ramadan": {"start": "2027-02-09", "end": None}, "eid_al_fitr": {"start": None, "end": None},
                "eid_al_adha": {"start": None, "end": None}, "periods": {"winter_2027_2028": {"valid_from": "2027-09-15"}}}
        self.assertEqual(va.validate_overrides(good), [])
        bad = json.loads(json.dumps(good))
        bad["ramadan"]["start"] = "09/02/2027"
        self.assertIn("ramadan.start", va.validate_overrides(bad)[0])
        bad = json.loads(json.dumps(good))
        bad["ramadan"]["end"] = "2027-02-01"
        self.assertIn("must not be after", va.validate_overrides(bad)[0])


if __name__ == "__main__":
    unittest.main()
