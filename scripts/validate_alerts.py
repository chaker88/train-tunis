"""Check public/data/alerts.json (and overrides.json) for mistakes before publishing.

Usage: python scripts/validate_alerts.py [alerts.json] [overrides.json]
"""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALERTS_FILE = ROOT / "public" / "data" / "alerts.json"
OVERRIDES_FILE = ROOT / "public" / "data" / "overrides.json"

SEVERITIES = ("info", "warning", "critical")
LINES = ("all", "A", "D", "E")
DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_json(path):
    """Return (data, errors)."""
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except OSError as e:
        return None, [f"Cannot open {path}: {e.strerror}."]
    try:
        return json.loads(text), []
    except json.JSONDecodeError as e:
        return None, [
            f"The file is not valid JSON (line {e.lineno}, column {e.colno}: {e.msg}). "
            "Look for a missing comma, a missing quote \" or an extra comma before } or ]."
        ]


def check_alert(alert, where, scheduled=False):
    errors = []
    if not isinstance(alert, dict):
        return [f"{where} must be a {{ ... }} block."]
    sev = alert.get("severity")
    if sev not in SEVERITIES:
        errors.append(f'{where}: "severity" must be "info", "warning" or "critical" (found {json.dumps(sev, ensure_ascii=False)}).')
    lines = alert.get("lines", ["all"])
    if not isinstance(lines, list) or not lines or any(l not in LINES for l in lines):
        errors.append(f'{where}: "lines" must be a list like ["all"] or ["A", "D"] using only all, A, D, E (found {json.dumps(lines, ensure_ascii=False)}).')
    for lang, label in (("ar", "Arabic"), ("en", "English")):
        text = alert.get(lang)
        if not isinstance(text, str) or not text.strip():
            errors.append(f'{where}: the {label} text "{lang}" is missing or empty.')
    if scheduled:
        times = {}
        for key in ("start", "end"):
            value = alert.get(key)
            if not isinstance(value, str) or not DATETIME_RE.match(value):
                errors.append(f'{where}: "{key}" must look like "2026-11-02T22:00" (found {json.dumps(value)}).')
                continue
            try:
                times[key] = datetime.strptime(value, "%Y-%m-%dT%H:%M")
            except ValueError:
                errors.append(f'{where}: "{key}" is not a real date/time ({value}).')
        if len(times) == 2 and times["start"] >= times["end"]:
            errors.append(f'{where}: "start" ({alert["start"]}) must be before "end" ({alert["end"]}).')
    return errors


def validate_alerts(data):
    if not isinstance(data, dict):
        return ["The file must contain one { ... } block with \"message\" and \"scheduled\"."]
    errors = []
    if "message" not in data:
        errors.append('The "message" block is missing.')
    else:
        errors += check_alert(data["message"], "message")
    scheduled = data.get("scheduled", [])
    if not isinstance(scheduled, list):
        errors.append('"scheduled" must be a list [ ... ] (use [] when there is nothing planned).')
    else:
        for i, alert in enumerate(scheduled, start=1):
            errors += check_alert(alert, f"scheduled alert #{i}", scheduled=True)
    return errors


def check_date(value, where):
    if value is None:
        return []
    if not isinstance(value, str) or not DATE_RE.match(value):
        return [f'{where} must be null or a date like "2027-02-09" (found {json.dumps(value)}).']
    try:
        date.fromisoformat(value)
    except ValueError:
        return [f"{where} is not a real date ({value})."]
    return []


def validate_overrides(data):
    if not isinstance(data, dict):
        return ["The file must contain one { ... } block."]
    errors = []
    for key in ("ramadan", "eid_al_fitr", "eid_al_adha"):
        block = data.get(key, {"start": None, "end": None})
        if not isinstance(block, dict):
            errors.append(f'"{key}" must look like {{ "start": null, "end": null }}.')
            continue
        block_errors = check_date(block.get("start"), f"{key}.start") + check_date(block.get("end"), f"{key}.end")
        errors += block_errors
        if not block_errors and block.get("start") and block.get("end") and block["start"] > block["end"]:
            errors.append(f"{key}: start ({block['start']}) must not be after end ({block['end']}).")
    periods = data.get("periods", {})
    if not isinstance(periods, dict):
        errors.append('"periods" must be a { ... } block (use {} when empty).')
    else:
        for pid, block in periods.items():
            if not isinstance(block, dict):
                errors.append(f'periods.{pid} must look like {{ "valid_from": "YYYY-MM-DD", "valid_to": "YYYY-MM-DD" }}.')
                continue
            errors += check_date(block.get("valid_from"), f"periods.{pid}.valid_from")
            errors += check_date(block.get("valid_to"), f"periods.{pid}.valid_to")
    return errors


def run(alerts_path=ALERTS_FILE, overrides_path=OVERRIDES_FILE):
    ok = True
    for path, validate in ((alerts_path, validate_alerts), (overrides_path, validate_overrides)):
        data, errors = load_json(path)
        if not errors:
            errors = validate(data)
        name = Path(path).name
        if errors:
            ok = False
            print(f"\n{name}: {len(errors)} problem(s) to fix in {path}")
            for e in errors:
                print(f"  - {e}")
        else:
            print(f"{name}: OK")
    return ok


if __name__ == "__main__":
    args = sys.argv[1:]
    ok = run(*(Path(a) for a in args[:2])) if args else run()
    sys.exit(0 if ok else 1)
