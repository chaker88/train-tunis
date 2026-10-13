# Next Train — القطار القادم

An **unofficial**, static, mobile-first website that shows the next 3 trains on the Tunis suburban network (lines **A**, **D** and **E**). Pick a line, your current station and your destination. The site shows departure, arrival, trip duration and a live countdown. It uses Tunisia time (`Africa/Tunis`) and automatically picks the right timetable (winter, summer, Ramadan), with Sunday and public-holiday service.

- Bilingual: Arabic (default, right-to-left) and English, toggled in the top-right corner.
- Plain HTML, CSS and vanilla JavaScript (ES modules). No framework, no build step, no backend, no external requests.
- Light and dark mode. Works offline once installed (the service worker is active only when not on localhost).

**Data source:** SNCFT Banlieue de Tunis timetables, transcribed into CSV files in `data/raw/`. This app is not affiliated with SNCFT. Always check at the station.

## Run locally

**Windows:** double-click **`start.bat`**. **macOS / Linux:** run `./start.sh`.

Both scripts build the timetables, check the message files, run the tests, open http://localhost:8000 and start the server. Keep the window open while you use the site.

The same steps by hand (requires Python 3.10+; Node 18+ is optional, for the JavaScript tests):

```bash
python scripts/build_data.py
python scripts/validate_alerts.py
python -m unittest discover tests
node --test tests/            # optional, if Node 18+ is installed
python -m http.server 8000 --directory public
```

Then open **http://localhost:8000**.
Test a scenario: http://localhost:8000/?now=2026-10-12T08:05

> On Node 21 and newer, `node --test tests/` no longer accepts a directory. Use `node --test "tests/*.test.mjs"` instead.

The site loads its data with `fetch()`, so it must be served over HTTP. Opening `index.html` directly from disk will not work.

### Simulated time

Add `?now=YYYY-MM-DDTHH:MM` (Tunisia local time) to the address to pretend it is that moment. A "Simulated time" badge appears. Useful checks:

| Address | What you should see |
|---|---|
| `?now=2026-10-12T08:05` | A normal weekday |
| `?now=2027-02-20T08:00` | Ramadan with no Ramadan timetable: warning, winter times shown |
| `?now=2027-03-09T08:05` | Eid al-Fitr: holiday service (like a Sunday) |
| `?now=2027-07-10T08:05` | Summer with no summer timetable: warning |

---

## Owner's guide

You only ever need to do two things: **add timetable files** and **edit the message**. You never have to change the code.

### 1. Add a new timetable

1. Open the folder `data/raw/`.
2. Create a new folder with **exactly** one of these names (use the real years):

   | Timetable | Folder name | Used from → to |
   |---|---|---|
   | Winter | `winter_2027_2028` | 1 Sep 2027 → 30 Jun 2028 |
   | Summer | `summer_2027` | 1 Jul 2027 → 31 Aug 2027 |
   | Ramadan | `ramadan_2028` | the whole month of Ramadan in 2028 (found automatically) |

3. Copy the CSV files into it. The file name must contain **Erriadh** (line A), **Gobaa** (line D) or **Bougatfa** (line E), for example `Erriadh_Tunis.csv`. You don't need all three lines: if Ramadan is published only for line A, put only that file. The other lines keep using the normal timetable, and the site shows a warning.
4. Double-click **`start.bat`**.

That's it. When a Ramadan or summer timetable applies, the site switches to it automatically. On Ramadan days, a Ramadan timetable always wins over winter or summer.

**About the CSV files:** keep the same columns as now (`Direction, Jours_Circulation, N_Train`, then one column per station from the suburban terminus to Tunis). Saving from Excel is fine:
- `,` or `;` separators both work.
- Times can be `05:10`, `5:10` or `05:10:00`.
- A cell that is empty, `0`, `0.0`, `-` or `–` means "the train does not stop here".
- In `Jours_Circulation`, `-` or empty means every day. `A` = not Sundays/holidays, `B` = only Sundays/holidays, `C` = weekdays only, `D` = not Saturdays.

**Old timetables:** you can leave them where they are. To keep one but stop using it, rename its folder to start with `_` (for example `_winter_2026_2027`).

**Change the dates of a timetable** (for example, winter starts on 15 September): see `periods` in step 2 below.

### 2. Ramadan and religious holidays

Ramadan, Eid al-Fitr, Eid al-Adha, the Islamic New Year and the Mawlid are **calculated automatically**. While Ramadan dates are automatic, the site shows a note that they may differ by one day from the official announcement. On the day before Ramadan and on its last day, it also asks people to check the announcement.

When the official date is announced, open `public/data/overrides.json` and write it in (format `"YYYY-MM-DD"`, in quotes):

```json
{
  "ramadan": { "start": "2027-02-09", "end": "2027-03-10" },
  "eid_al_fitr": { "start": "2027-03-11", "end": "2027-03-12" },
  "eid_al_adha": { "start": null, "end": null },
  "periods": {}
}
```

- Fill in only what you know. Leave the rest as `null` (no quotes).
- If you change the end of Ramadan, Eid al-Fitr moves with it automatically.
- Save and reload the page. No restart is needed (running `start.bat` also checks the file for mistakes).
- **Next year,** set the dates back to `null`. Old dates are ignored automatically anyway: a 2027 date never affects Ramadan 2028.

To change the dates of a timetable folder, add it under `periods`:

```json
"periods": { "winter_2027_2028": { "valid_from": "2027-09-15", "valid_to": "2028-06-30" } }
```

The fixed public holidays (1 Jan, 20 Mar, 9 Apr, 1 May, 25 Jul, 13 Aug, 15 Oct, 17 Dec) repeat every year and are listed in `public/data/holidays.json`. To add a one-off holiday, put it in `"dates"`, for example `{ "date": "2027-04-12", "name_en": "Exceptional holiday", "name_ar": "عطلة استثنائية" }`.

### 3. Change the "Good to know" message

Open **`public/data/alerts.json`** in Notepad, change the `message` block, save, and **reload the page**. That's all.

- `severity`: `"info"` (calm blue card), `"warning"` (orange card, also shown above the train times) or `"critical"` (red card plus a red banner at the top of the page).
- `lines`: `["all"]` for every line, or for example `["A"]` or `["A", "E"]`. A warning or critical message is shown prominently only to people looking at those lines. It always appears in "Good to know".
- `ar` and `en`: the text in Arabic and English. Both are required.

**Normal (default):**
```json
"message": { "severity": "info", "lines": ["all"], "ar": "رحلة سعيدة 🚆", "en": "Have a nice trip 🚆" }
```

**Warning:**
```json
"message": { "severity": "warning", "lines": ["D"],
  "ar": "تأخيرات على الخط D بسبب الأمطار الغزيرة.",
  "en": "Delays on line D because of heavy rain." }
```

**Critical:**
```json
"message": { "severity": "critical", "lines": ["A"],
  "ar": "انقطاع التيار الكهربائي: حركة القطارات متوقفة على الخط A حتى إشعار آخر.",
  "en": "Power outage: no trains on line A until further notice." }
```

When the problem is over, paste the **Normal** block back. Keep the rest of the file as it is: `{ "message": { ... }, "scheduled": [] }`.

### 4. Planned alerts (they appear and disappear on their own)

For works you know about in advance, add them to `scheduled` with a start and an end (Tunisia time, format `YYYY-MM-DDTHH:MM`):

```json
{
  "message": { "severity": "info", "lines": ["all"], "ar": "رحلة سعيدة 🚆", "en": "Have a nice trip 🚆" },
  "scheduled": [
    { "severity": "warning", "lines": ["D"], "start": "2026-11-02T22:00", "end": "2026-11-03T05:00",
      "ar": "أشغال صيانة: لا قطارات بعد الساعة 22:00.", "en": "Maintenance works: no trains after 22:00." }
  ]
}
```

Separate several planned alerts with a comma: `[ {...}, {...} ]`. Expired ones are simply ignored, and you can delete them whenever you like.

### 5. If something fails

`start.bat` stops and shows a message. The message names the file and, for timetables, the train number and column. Fix it, save, and double-click `start.bat` again.

| Message | What it means / what to do |
|---|---|
| `Folder 'data/raw/...' has an unexpected name` | Rename the folder exactly like `winter_2027_2028`, `summer_2027` or `ramadan_2028` (lowercase, underscores). |
| `CSV files must be inside a timetable folder` | A CSV file was put directly in `data/raw/`. Move it into its period folder. |
| `cannot tell which line this file is for` | Rename the CSV so it contains Erriadh, Gobaa or Bougatfa. |
| `unknown station` | A station column name is misspelled, or it is a new station. Fix the spelling, or add the station to `data/stations.json` as the message explains. |
| `invalid time '...'` | A time cell is not like `05:10`. Fix that cell (the message gives the train and the station). |
| `is not after ...` / `Times must increase` | A time is earlier than the previous stop's: probably a typing mistake in that train's row. |
| `train number ... is already used` | Two rows have the same train number. |
| `unknown code` in `Jours_Circulation` | Use only `-`, `A`, `B`, `C` or `D`. |
| `alerts.json ... not valid JSON` | A comma or quote is missing near the line given. Compare with the templates above. |
| `"severity" must be ...`, `text "ar" is missing`, `"start" ... must be before "end"` | Fix that field in `alerts.json` as described. |
| `The server could not start` | The site is already running in another window. Close it and try again. |

If `alerts.json` is broken and you reload the page without running `start.bat`, the site doesn't break: it shows "Have a nice trip" and ignores the broken message.

---

## Project layout

| Path | What it is |
|---|---|
| `data/raw/<period>/` | Timetable CSV files, one folder per period |
| `data/stations.json` | Station names (Arabic/English) and accepted CSV spellings |
| `scripts/build_data.py` | Reads all period folders and writes `public/data/<period>/line_*.json` plus `public/data/timetables.json` |
| `scripts/validate_alerts.py` | Checks `alerts.json` and `overrides.json` |
| `public/data/alerts.json` | The "Good to know" message and planned alerts (edit by hand) |
| `public/data/overrides.json` | Official Ramadan/Eid dates and period date changes (edit by hand) |
| `public/data/holidays.json` | Fixed public holidays |
| `public/js/search.js` | Next-train query |
| `public/js/calendar.js` | Tunisia time, Hijri calendar, holidays, choice of timetable |
| `public/js/i18n.js` / `public/locales/` | Languages and all UI text |
| `public/js/app.js` | Page wiring and rendering |
| `tests/` | Python (`unittest`) and JavaScript (`node:test`) tests |
| `images/` | Original owner-supplied images (optimized copies are in `public/assets/img/`) |
| `start.bat` / `start.sh` | One-click build, check, test and run |

## Credits

- Font: [Cairo](https://github.com/Gue3bara/Cairo), SIL Open Font License 1.1 (`public/assets/fonts/OFL.txt`), self-hosted.
- Photos: supplied by the project owner.
