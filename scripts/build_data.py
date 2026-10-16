"""Build the timetable JSON files in public/data/ from the CSV folders in data/raw/.

Every folder in data/raw/ is one timetable period (winter_2026_2027, summer_2027, ramadan_2027...).
Folders starting with "_" or "." are ignored.
Optional timetable posters in data/raw/<period>/posters/line_A.jpg (or .png/.webp/.pdf) are copied
to public/downloads/<period>/ with readable names. A missing poster never fails the build.
"""
import csv
import io
import json
import re
import shutil
import sys
import unicodedata
from datetime import date
from pathlib import Path

import build_site

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
STATIONS_FILE = ROOT / "data" / "stations.json"
OUT_DIR = ROOT / "public" / "data"
DOWNLOADS_DIR = ROOT / "public" / "downloads"

SERVICES = {
    "-": "daily",
    "–": "daily",
    "—": "daily",
    "": "daily",
    "A": "no_sun_hol",
    "B": "sun_hol_only",
    "C": "no_sat_sun_hol",
    "D": "no_sat",
}
NO_STOP = {"", "0", "0.0", "0,0", "-", "–", "—"}
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
TRAIN_RE = re.compile(r"^(\d+)(?:[.,]0+)?$")

LINES = {
    "A": {"detect": "erriadh", "name": {"en": "Tunis ↔ Erriadh", "ar": "تونس ↔ الرياض"}, "color": "#1565C0"},
    "D": {"detect": "gobaa", "name": {"en": "Tunis ↔ Gobaa Ville", "ar": "تونس ↔ القباعة المدينة"}, "color": "#E8701A"},
    "E": {"detect": "bougatfa", "name": {"en": "Tunis ↔ Bougatfa", "ar": "تونس ↔ بوقطفة"}, "color": "#2E9E4F"},
}

PERIOD_TYPES = [
    ("winter", re.compile(r"^winter_(\d{4})_(\d{4})$"), 1),
    ("summer", re.compile(r"^summer_(\d{4})$"), 2),
    ("ramadan", re.compile(r"^ramadan_(\d{4})$"), 3),
]
FOLDER_HELP = (
    "Timetable folders in data/raw/ must be named like:\n"
    "    winter_2026_2027   (winter, 1 Sep 2026 -> 30 Jun 2027)\n"
    "    summer_2027        (summer, 1 Jul 2027 -> 31 Aug 2027)\n"
    "    ramadan_2027       (Ramadan of 2027, dates found automatically)\n"
    "To keep an old folder without using it, rename it to start with an underscore, e.g. _old_winter."
)


POSTER_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".pdf")
POSTER_TYPE_WORD = {"winter": "hiver", "summer": "ete", "ramadan": "ramadan"}


class BuildError(Exception):
    pass


def norm(text):
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if c.isalnum() and not unicodedata.combining(c)).lower()


def rel(path):
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


# --- Hijri helpers (tabular Islamic calendar; only used to label the Ramadan year) ---

def islamic_to_ordinal(year, month, day):
    jdn = day + -(-59 * (month - 1) // 2) + (year - 1) * 354 + (3 + 11 * year) // 30 + 1948439
    return jdn - 1721425


def ramadan_hijri_year(greg_year):
    """Hijri year whose month of Ramadan starts in the given Gregorian year (the first one if two do)."""
    guess = round((greg_year - 622) * 33 / 32)
    for h in range(guess - 2, guess + 3):
        if date.fromordinal(islamic_to_ordinal(h, 9, 1)).year == greg_year:
            return h
    raise BuildError(f"Could not find Ramadan for year {greg_year}")


# --- Periods ---

def parse_period(folder_name):
    name = folder_name.lower()
    for ptype, pattern, priority in PERIOD_TYPES:
        m = pattern.match(name)
        if not m:
            continue
        year = int(m.group(1))
        period = {"id": name, "type": ptype, "priority": priority}
        if ptype == "winter":
            if int(m.group(2)) != year + 1:
                raise BuildError(f"Folder '{folder_name}': the second year must follow the first (e.g. winter_{year}_{year + 1}).")
            period.update(valid_from=f"{year}-09-01", valid_to=f"{year + 1}-06-30",
                          name={"ar": f"توقيت الشتاء {year}-{year + 1}", "en": f"Winter timetable {year}–{year + 1}"})
        elif ptype == "summer":
            period.update(valid_from=f"{year}-07-01", valid_to=f"{year}-08-31",
                          name={"ar": f"توقيت الصيف {year}", "en": f"Summer timetable {year}"})
        else:
            period.update(hijri_year=ramadan_hijri_year(year), valid_from=None, valid_to=None,
                          name={"ar": f"توقيت رمضان {year}", "en": f"Ramadan timetable {year}"})
        return period
    raise BuildError(f"Folder 'data/raw/{folder_name}' has an unexpected name.\n{FOLDER_HELP}")


def discover(raw_dir):
    if not raw_dir.is_dir():
        raise BuildError(f"Folder {rel(raw_dir)} does not exist.")
    loose = sorted(p.name for p in raw_dir.iterdir() if p.is_file() and p.suffix.lower() == ".csv")
    if loose:
        raise BuildError(
            f"CSV files must be inside a timetable folder, not directly in {rel(raw_dir)}: {', '.join(loose)}.\n{FOLDER_HELP}"
        )
    periods = []
    for folder in sorted(p for p in raw_dir.iterdir() if p.is_dir()):
        if folder.name.startswith(("_", ".")):
            continue
        period = parse_period(folder.name)
        files = {}
        for f in sorted(folder.iterdir()):
            if not f.is_file() or f.name.startswith((".", "~$")):
                continue
            if f.suffix.lower() != ".csv":
                print(f"  note: ignoring {rel(f)} (only .csv files are read; in Excel use 'Save As > CSV').")
                continue
            matches = [code for code, spec in LINES.items() if spec["detect"] in f.name.lower()]
            if len(matches) != 1:
                raise BuildError(
                    f"{rel(f)}: cannot tell which line this file is for. "
                    "The file name must contain exactly one of: Erriadh (line A), Gobaa (line D), Bougatfa (line E)."
                )
            code = matches[0]
            if code in files:
                raise BuildError(f"{rel(folder)}: two files for line {code}: {files[code].name} and {f.name}. Keep only one.")
            files[code] = f
        if not files:
            print(f"  note: {rel(folder)} has no CSV files yet, skipped.")
            continue
        periods.append((period, files, folder))
    if not periods:
        raise BuildError(f"No timetable found in {rel(raw_dir)}.\n{FOLDER_HELP}")
    return periods


# --- Timetable posters (downloads) ---

def sniff_ext(data):
    """Real file type from its first bytes: a poster saved as .jpg may really be a WebP or PNG."""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:5] == b"%PDF-":
        return ".pdf"
    return None


def poster_name(period, code, ext):
    years = "-".join(re.findall(r"\d{4}", period["id"]))
    return f"horaires-ligne-{code}-{POSTER_TYPE_WORD[period['type']]}-{years}{ext}"


def find_posters(folder):
    """{line code: path} for data/raw/<period>/posters/line_<code>.<ext>. Missing posters are simply absent."""
    pdir = folder / "posters"
    found = {}
    if not pdir.is_dir():
        return found
    for f in sorted(pdir.iterdir()):
        m = re.fullmatch(r"line_([a-z])", f.stem, re.IGNORECASE)
        if not f.is_file() or f.suffix.lower() not in POSTER_EXTS or not m or m.group(1).upper() not in LINES:
            if f.is_file() and not f.name.startswith("."):
                print(f"  note: ignoring {rel(f)} (posters must be named line_A, line_D or line_E with .jpg, .png, .webp or .pdf).")
            continue
        code = m.group(1).upper()
        if code in found:
            print(f"  note: two posters for line {code} in {rel(pdir)}; using {found[code].name}, ignoring {f.name}.")
            continue
        found[code] = f
    return found


def copy_posters(period, folder, downloads_dir):
    """Copy the period's posters to downloads_dir/<period>/. Returns {code: {"path", "bytes"}} for timetables.json.

    The Python standard library cannot decode or re-encode JPEG/WebP images, so posters are copied unchanged."""
    out = {}
    for code, src in find_posters(folder).items():
        data = src.read_bytes()
        ext = sniff_ext(data)
        if ext is None:
            print(f"  note: {rel(src)} is not a readable JPEG, PNG, WebP or PDF file; its download button is hidden.")
            continue
        if ext != src.suffix.lower().replace(".jpeg", ".jpg"):
            print(f"  note: {rel(src)} is really a {ext[1:].upper()} file; it is published as {ext}.")
        name = poster_name(period, code, ext)
        pdir = downloads_dir / period["id"]
        pdir.mkdir(parents=True, exist_ok=True)
        (pdir / name).write_bytes(data)
        out[code] = {"path": f"downloads/{period['id']}/{name}", "bytes": len(data)}
    return out


# --- Lenient CSV reading ---

def read_rows(path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "cp1256"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise BuildError(f"{rel(path)}: cannot read the file. Save it again as 'CSV UTF-8'.")
    first = next((line for line in text.splitlines() if line.strip()), "")
    sep = max((";", ",", "\t"), key=first.count)
    rows = []
    for row in csv.reader(io.StringIO(text), delimiter=sep):
        row = [c.replace("\xa0", " ").strip() for c in row]
        if any(row):
            rows.append(row)
    return rows


def parse_time(value):
    if value in NO_STOP:
        return None
    m = TIME_RE.match(value)
    if not m:
        raise ValueError(f"invalid time '{value}' (expected HH:MM, or empty / 0 / - when the train does not stop)")
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if h > 23 or mi > 59 or s > 59:
        raise ValueError(f"invalid time '{value}'")
    return h * 60 + mi


def load_stations(stations_file):
    try:
        data = json.loads(stations_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise BuildError(f"{rel(stations_file)}: cannot read station list ({e}).")
    lookup = {}
    for code in LINES:
        entries = data.get(code)
        if not isinstance(entries, list) or not entries:
            raise BuildError(f"{rel(stations_file)}: missing station list for line {code}.")
        table = {}
        for idx, s in enumerate(entries):
            for key in ("id", "en", "ar"):
                if not s.get(key):
                    raise BuildError(f"{rel(stations_file)}: line {code}, station #{idx + 1} has no '{key}'.")
            for alias in [*s.get("csv", []), s["en"], s["ar"], s["id"]]:
                table.setdefault(norm(alias), (idx, s))
        lookup[code] = table
    return lookup


def build_line(code, path, period, stations):
    rows = read_rows(path)
    where = rel(path)
    if not rows:
        raise BuildError(f"{where}: file is empty")
    header = rows[0]
    while header and not header[-1]:
        header.pop()
    if [norm(h) for h in header[:3]] != ["direction", "jourscirculation", "ntrain"]:
        raise BuildError(f"{where}: the first three columns must be Direction, Jours_Circulation, N_Train (found {header[:3]}).")

    cols = []
    for col_no, name in enumerate(header[3:], start=4):
        hit = stations[code].get(norm(name))
        if not hit:
            raise BuildError(
                f"{where}, column {col_no} '{name}': unknown station for line {code}.\n"
                f"  Fix the spelling, or add the station to data/stations.json under \"{code}\" at its place in the line "
                f"(from the terminus to Tunis), e.g.\n"
                f'    {{"id": "new-station", "en": "{name}", "ar": "...", "csv": ["{name}"]}}'
            )
        if cols and hit[0] <= cols[-1][0]:
            raise BuildError(
                f"{where}, column {col_no} '{name}': station columns are out of order or repeated. "
                "They must go from the suburban terminus to Tunis, as in data/stations.json."
            )
        cols.append(hit)
    if len(cols) < 2:
        raise BuildError(f"{where}: needs at least two station columns.")
    width = 3 + len(cols)

    trips, seen = [], {}
    for n, row in enumerate(rows[1:], start=2):
        if len(row) > width and any(row[width:]):
            raise BuildError(f"{where}, row {n}: has more cells than the header ({len(header)} columns).")
        row = (row + [""] * width)[:width]
        direction, service_code, train_raw = row[:3]
        m = TRAIN_RE.match(train_raw)
        if not m:
            raise BuildError(f"{where}, row {n}, column 'N_Train': invalid train number '{train_raw}'.")
        train = int(m.group(1))
        at = f"{where}, train {train} (row {n})"
        if train in seen:
            raise BuildError(f"{at}: train number {train} is already used on row {seen[train]}.")
        seen[train] = n

        d = norm(direction)
        if d.endswith("totunis"):
            dir_ = "to_tunis"
        elif d.startswith("tunisto"):
            dir_ = "from_tunis"
        else:
            raise BuildError(f"{at}, column 'Direction': '{direction}' must look like '<Terminus>_to_Tunis' or 'Tunis_to_<Terminus>'.")
        service = SERVICES.get(service_code.upper())
        if service is None:
            raise BuildError(f"{at}, column 'Jours_Circulation': unknown code '{service_code}' (use -, A, B, C or D).")

        stops = []
        for i, cell in enumerate(row[3:]):
            try:
                t = parse_time(cell)
            except ValueError as e:
                raise BuildError(f"{at}, column '{header[3 + i]}': {e}.")
            if t is not None:
                stops.append([i, t])
        if dir_ == "from_tunis":
            stops.reverse()
        if len(stops) < 2:
            raise BuildError(f"{at}: the train must stop at 2 stations or more.")
        for (s1, t1), (s2, t2) in zip(stops, stops[1:]):
            if t2 <= t1:
                raise BuildError(
                    f"{at}, column '{header[3 + s2]}': time {t2 // 60:02d}:{t2 % 60:02d} is not after "
                    f"{t1 // 60:02d}:{t1 % 60:02d} at '{header[3 + s1]}'. Times must increase in the direction of travel."
                )
        trips.append({"train": train, "service": service, "dir": dir_, "stops": stops})

    trips.sort(key=lambda t: (t["dir"] != "to_tunis", t["stops"][0][1], t["train"]))
    spec = LINES[code]
    return {
        "line": code,
        "period": period["id"],
        "name": spec["name"],
        "color": spec["color"],
        "timetable": period["name"]["en"],
        "valid_from": period["valid_from"],
        "valid_to": period["valid_to"],
        "stations": [{"id": s["id"], "en": s["en"], "ar": s["ar"]} for _, s in cols],
        "trips": trips,
    }


def build(raw_dir=RAW_DIR, out_dir=OUT_DIR, stations_file=STATIONS_FILE, downloads_dir=None):
    """downloads_dir: where posters are copied (main() passes public/downloads). None skips posters."""
    stations = load_stations(stations_file)
    found = discover(raw_dir)
    built = []
    for period, files, folder in found:
        lines = {code: build_line(code, path, period, stations) for code, path in sorted(files.items())}
        built.append((period, lines, folder))

    out_dir.mkdir(parents=True, exist_ok=True)
    keep = {p["id"] for p, _, _ in built}
    for base in (out_dir, downloads_dir):
        if base is None or not base.is_dir():
            continue
        for d in base.iterdir():
            if d.is_dir() and (d.name not in keep or base == downloads_dir) and any(p.match(d.name) for _, p, _ in PERIOD_TYPES):
                shutil.rmtree(d)
    index, summary = [], []
    for period, lines, folder in built:
        pdir = out_dir / period["id"]
        if pdir.exists():
            shutil.rmtree(pdir)
        pdir.mkdir()
        for code, data in lines.items():
            with (pdir / f"line_{code}.json").open("w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            counts = {d: sum(t["dir"] == d for t in data["trips"]) for d in ("to_tunis", "from_tunis")}
            summary.append((period["id"], code, counts["to_tunis"], counts["from_tunis"]))
        entry = {**{k: v for k, v in period.items() if k != "name"}, "lines": sorted(lines), "name": period["name"]}
        if downloads_dir is not None:
            entry["downloads"] = copy_posters(period, folder, downloads_dir)
        index.append(entry)
    index.sort(key=lambda p: (p["priority"], p["id"]))
    with (out_dir / "timetables.json").open("w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return summary


def main():
    try:
        summary = build(downloads_dir=DOWNLOADS_DIR)
    except BuildError as e:
        print(f"\nBUILD FAILED\n{e}\n", file=sys.stderr)
        sys.exit(1)
    print(f"{'Period':<20} {'Line':<5} {'to Tunis':>9} {'from Tunis':>11}")
    for pid, code, to_t, from_t in summary:
        print(f"{pid:<20} {code:<5} {to_t:>9} {from_t:>11}")
    print(f"OK: {len(summary)} timetable files written to {rel(OUT_DIR)}/")
    index = json.loads((OUT_DIR / "timetables.json").read_text(encoding="utf-8"))
    posters = [(p["id"], code, d) for p in index for code, d in sorted(p.get("downloads", {}).items())]
    for pid, code, d in posters:
        print(f"  poster {pid} line {code}: public/{d['path']} ({d['bytes'] / 1024:.0f} KB)")
    if not posters:
        print("  no timetable posters found (optional: data/raw/<period>/posters/line_A.jpg ...)")
    build_site.main()


if __name__ == "__main__":
    main()
