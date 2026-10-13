# Build Instructions — Tunis Suburban "Next Train" Web App

> **For Claude Code.** Read this whole file before writing anything, then build the project end to end.
> **Phase 1 scope: the app runs LOCALLY ONLY** (`http://localhost:8000`). Do **not** set up hosting, deployment, CI/CD, domains, or any cloud service. Online deployment is a later, separate phase.

---

## 1. What we are building

A static, mobile-first website that tells a commuter the **next trains** on the Tunis suburban network (SNCFT Banlieue de Tunis, Winter 2026–2027 timetable).

The user picks:
1. **Line**: A, D or E (the lines are independent; stations from one line never appear on another)
2. **From** station (current station)
3. **To** station (destination)

The app reads the **current date and time in Tunisia**, then shows the **next 3 departures** that stop at both stations, with departure time, arrival time, trip duration and minutes until departure.

The UI is bilingual: **Arabic (default, RTL)** and **English (LTR)**, switched by a toggle in the **top-right corner**.

---

## 2. Hard constraints

- **Plain HTML + CSS + vanilla JavaScript (ES modules).** No frameworks, no bundler, no npm runtime dependencies, no CDN links. Everything must work offline once loaded.
- **Data pipeline in Python 3.10+ using the standard library only** (`csv`, `json`, `pathlib`, `unittest`). No pandas.
- **No backend, no database, no API.** The app loads static JSON files from its own folder.
- **No GPS / geolocation.** Station selection is manual only.
- **Unofficial app:** do not use the SNCFT logo or imitate SNCFT branding. Footer must say it is unofficial (see §7).
- Keep code minimal and readable; avoid excessive comments.

---

## 3. Input data (already provided)

Three CSV files are in `data/` (directly inside it). **Move them to `data/raw/`** as the first step.

The project also contains an `image/` folder with images for the website. See §5.1.

| File | Line | Suburban terminus |
|---|---|---|
| `Erriadh_Tunis.csv` | **A** | Erriadh |
| `Gobaa_Ville_Tunis.csv` | **D** | Gobaa Ville |
| `Bougatfa_Tunis.csv` | **E** | Bougatfa |

### CSV format (identical for all three)

```
Direction,Jours_Circulation,N_Train,<Station 1>,<Station 2>,...,<Tunis>
```

- `Direction`: `<Terminus>_to_Tunis` (inbound) or `Tunis_to_<Terminus>` (outbound). Examples: `Erriadh_to_Tunis`, `Tunis_to_Erriadh`, `GobaaVille_to_Tunis`, `Tunis_to_GobaaVille`, `Bougatfa_to_Tunis`, `Tunis_to_Bougatfa`.
- `Jours_Circulation`: service code (see §4.3).
- `N_Train`: train number (unique within a line).
- Station columns are **always ordered from the suburban terminus to Tunis**, for both directions. For outbound rows (`Tunis_to_…`), the trip therefore runs **right-to-left** across the columns.
- Times are `HH:MM` strings (24h). No time passes midnight (latest is 23:02).
- **`0.0` means the train does NOT stop at that station** (express/direct trains). Never treat `0.0` as a time.

The data has already been cleaned of known typos. Every trip's times strictly increase in travel direction; the build must still verify this (§8).

---

## 4. Reference data

### 4.1 Lines

| Line | EN name | AR name | Color |
|---|---|---|---|
| A | Tunis ↔ Erriadh | تونس ↔ الرياض | `#1565C0` (blue) |
| D | Tunis ↔ Gobaa Ville | تونس ↔ القباعة المدينة | `#E8701A` (orange) |
| E | Tunis ↔ Bougatfa | تونس ↔ بوقطفة | `#2E9E4F` (green) |

### 4.2 Stations (CSV column name → id, EN display, AR display), in CSV order

**Line A**
| CSV column | id | EN | AR |
|---|---|---|---|
| Erriadh | erriadh | Erriadh | الرياض |
| Borj Cedria | borj-cedria | Borj Cedria | برج السدرية |
| Bir El Bey | bir-el-bey | Bir El Bey | بئر الباي |
| Hammam Chatt | hammam-chatt | Hammam Chatt | حمام الشط |
| Tahar Sfar | tahar-sfar | Tahar Sfar | الطاهر صفر |
| Arret du Stade | arret-du-stade | Arrêt du Stade | محطة الملعب |
| Hammam Lif | hammam-lif | Hammam Lif | حمام الأنف |
| Bou Kornine | bou-kornine | Bou Kornine | بوقرنين |
| Lycee Ezzahra | lycee-ezzahra | Lycée Ezzahra | معهد الزهراء |
| Ez-Zahra | ez-zahra | Ez-Zahra | الزهراء |
| Rades Meliane | rades-meliane | Radès Méliane | رادس مليان |
| Rades | rades | Radès | رادس |
| Lycee Rades | lycee-rades | Lycée Radès | معهد رادس |
| Sidi Rezig | sidi-rezig | Sidi Rezig | سيدي رزيق |
| Megrine | megrine | Mégrine | مقرين |
| Megrine Ryadh | megrine-ryadh | Mégrine Riadh | مقرين الرياض |
| Jebel Jelloud | jebel-jelloud | Jebel Jelloud | جبل الجلود |
| Tunis Ville | tunis | Tunis | تونس |

**Line D**
| CSV column | id | EN | AR |
|---|---|---|---|
| Gobaa Ville | gobaa-ville | Gobaa Ville | القباعة المدينة |
| Gobaa | gobaa | Gobaa | القباعة |
| Les Orangers | les-orangers | Les Orangers | حي البرتقال |
| Mannouba | mannouba | Manouba | منوبة |
| El Bortal | el-bortal | El Bortal | البرطال |
| Le Bardo | le-bardo | Le Bardo | باردو |
| Erraoudha | erraoudha | Erraoudha | الروضة |
| Mellassine | mellassine | Mellassine | الملاسين |
| Sayada Mannoubia | saida-manoubia | Saïda Manoubia | السيدة المنوبية |
| Tunis | tunis | Tunis | تونس |

**Line E**
| CSV column | id | EN | AR |
|---|---|---|---|
| Bougatfa | bougatfa | Bougatfa | بوقطفة |
| Al Hrairiya | al-hrairiya | Al Hrairiya | الحرارية |
| Ezzouhour | ezzouhour | Ezzouhour | الزهور |
| Ettayarane | ettayarane | Ettayarane | الطيران |
| Ennajah | ennajah | Ennajah | النجاح |
| Saida Manoubia | saida-manoubia | Saïda Manoubia | السيدة المنوبية |
| Tunis | tunis | Tunis | تونس |

### 4.3 Service codes (`Jours_Circulation`)

The poster letters A/B/C/D clash with line letters A/D/E. **In JSON and code, never store the raw letter; map it to these names:**

| CSV value | JSON `service` | Runs on |
|---|---|---|
| `-` | `daily` | Every day |
| `A` | `no_sun_hol` | Every day **except** Sundays and public holidays |
| `B` | `sun_hol_only` | **Only** Sundays and public holidays |
| `C` | `no_sat_sun_hol` | Every day except Saturdays, Sundays and public holidays (line A only) |
| `D` | `no_sat` | Every day except Saturdays (line A only) |

Unknown codes must make the build fail.

### 4.4 Public holidays → `public/data/holidays.json`

Create this file with the dates below. Religious dates follow the lunar calendar and are **estimates**; keep the `"estimated": true` flag so they can be confirmed later.

```json
{
  "valid_from": "2026-09-01",
  "valid_to": "2027-06-30",
  "holidays": [
    { "date": "2026-10-15", "name_en": "Evacuation Day",            "name_ar": "عيد الجلاء" },
    { "date": "2026-12-17", "name_en": "Revolution Day",            "name_ar": "عيد الثورة" },
    { "date": "2027-01-01", "name_en": "New Year's Day",            "name_ar": "رأس السنة الميلادية" },
    { "date": "2027-03-10", "name_en": "Eid al-Fitr",               "name_ar": "عيد الفطر", "estimated": true },
    { "date": "2027-03-11", "name_en": "Eid al-Fitr (day 2)",       "name_ar": "عيد الفطر", "estimated": true },
    { "date": "2027-03-20", "name_en": "Independence Day",          "name_ar": "عيد الاستقلال" },
    { "date": "2027-04-09", "name_en": "Martyrs' Day",              "name_ar": "عيد الشهداء" },
    { "date": "2027-05-01", "name_en": "Labour Day",                "name_ar": "عيد الشغل" },
    { "date": "2027-05-16", "name_en": "Eid al-Adha",               "name_ar": "عيد الأضحى", "estimated": true },
    { "date": "2027-05-17", "name_en": "Eid al-Adha (day 2)",       "name_ar": "عيد الأضحى", "estimated": true },
    { "date": "2027-06-06", "name_en": "Islamic New Year",          "name_ar": "رأس السنة الهجرية", "estimated": true }
  ]
}
```

---

## 5. Project structure (create exactly this)

```
<project-root>/
├── BUILD_INSTRUCTIONS.md
├── image/                       # owner-supplied source images (keep)
├── README.md
├── .gitignore
├── data/
│   └── raw/
│       ├── Erriadh_Tunis.csv
│       ├── Gobaa_Ville_Tunis.csv
│       └── Bougatfa_Tunis.csv
├── scripts/
│   └── build_data.py
├── tests/
│   ├── test_build_data.py
│   └── search.test.mjs
└── public/                      # the website root (served locally)
    ├── index.html
    ├── manifest.webmanifest
    ├── sw.js
    ├── css/
    │   └── styles.css
    ├── js/
    │   ├── app.js               # UI wiring, state, rendering
    │   ├── search.js            # pure functions: next-train query
    │   ├── calendar.js          # pure functions: Tunis time, service rules, holidays
    │   └── i18n.js              # language switch, RTL/LTR, string lookup
    ├── locales/
    │   ├── ar.json
    │   └── en.json
    ├── data/
    │   ├── line_A.json          # generated
    │   ├── line_D.json          # generated
    │   ├── line_E.json          # generated
    │   └── holidays.json        # hand-written (§4.4)
    └── assets/
        ├── icons/               # app icons (no SNCFT logo)
        └── img/                 # images copied from image/ (§5.1)
```

### 5.1 Images

- The `image/` folder at the project root holds the source images supplied by the owner. Keep it as the original source; do not delete it.
- Only files inside `public/` are served, so copy the images the site uses into `public/assets/img/` and reference them with relative paths (`assets/img/...`).
- **You decide where each image goes** (hero, section background, illustration, icon, or unused) based on what makes the site look best (§7.6). Do not ask the owner; at the end, report which image went where and which were left unused.
- Do not use any image that is the SNCFT logo or copied from official SNCFT material; tell the owner which ones you skipped and why.
- Optimize what you copy: max 1600 px wide, compressed, with WebP versions where the format allows. Keep the total under ~500 KB if possible, because users are on mobile data.
- Every `<img>` needs `alt` text in both languages through i18n, plus `width`/`height` attributes to avoid layout shift.
- If an app icon can be derived from a supplied image (and it is not a logo), use it for `assets/icons/`; otherwise generate a simple icon.

---

## 6. Data pipeline — `scripts/build_data.py`

Run with: `python scripts/build_data.py`

It reads the three CSVs and writes `public/data/line_A.json`, `line_D.json`, `line_E.json`.

### 6.1 Output schema (one file per line)

```json
{
  "line": "E",
  "name": { "en": "Tunis ↔ Bougatfa", "ar": "تونس ↔ بوقطفة" },
  "color": "#2E9E4F",
  "timetable": "Winter 2026–2027",
  "valid_from": "2026-09-01",
  "valid_to": "2027-06-30",
  "stations": [
    { "id": "bougatfa", "en": "Bougatfa", "ar": "بوقطفة" },
    { "id": "tunis",    "en": "Tunis",    "ar": "تونس" }
  ],
  "trips": [
    {
      "train": 428,
      "service": "daily",
      "dir": "to_tunis",
      "stops": [[0, 500], [1, 502], [6, 515]]
    }
  ]
}
```

- `stations`: ordered **from suburban terminus (index 0) to Tunis (last index)**, same as CSV columns.
- `dir`: `"to_tunis"` or `"from_tunis"`.
- `stops`: list of `[stationIndex, minutesSinceMidnight]` **in travel order**, containing **only stations where the train stops** (skip `0.0`). For `from_tunis` trips this means descending station indices.
- Trips sorted by first departure time within each direction.

### 6.2 Build-time validation (fail loudly with a clear message)

- Every `0.0`/time cell parses; every non-`0.0` time matches `HH:MM`.
- Every trip has ≥ 2 stops.
- Times strictly increase along each trip in travel order.
- Train numbers are unique within a line.
- Every `Jours_Circulation` value is in the §4.3 table.
- Every CSV station column exists in the §4.2 table.

Print a summary: trips per line and direction.

---

## 7. App behaviour

### 7.1 Current time
- Get "now" in **`Africa/Tunis`** via `Intl.DateTimeFormat(..., { timeZone: "Africa/Tunis" })` — never trust the device's time zone.
- **Testing override:** if the URL has `?now=2026-10-12T08:05`, use that as the Tunis local time instead of the clock. Show a small "simulated time" badge when active.
- Refresh results every 30 seconds and when the tab becomes visible again.

### 7.2 Service-day rules (`calendar.js`)
- `isHoliday(date)` from `holidays.json`.
- `runsOn(service, date)` per §4.3 (Sunday = day 0).

### 7.3 Next-train query (`search.js`, pure function)

`nextTrains(lineData, holidays, originId, destId, nowTunis, count = 3)`:
1. `oIdx`, `dIdx` = station indices. If equal → no result.
2. Direction: `oIdx < dIdx` → `to_tunis`, else `from_tunis`.
3. Candidate trips = trips in that direction that **stop at both** origin and destination, with origin stop before destination stop. (Express trains that skip either station are excluded automatically.)
4. Today: keep trips where `runsOn(service, today)` and departure at origin ≥ now (minutes). Sort by departure.
5. If fewer than `count`, fill with **tomorrow's** first trips (using tomorrow's service rules), marked `tomorrow: true`.
6. Return objects: `{ train, depart, arrive, durationMin, minutesUntil, tomorrow, express }` where `express` = the train skips at least one station strictly between origin and destination.

### 7.4 UI (`index.html`, `styles.css`, `app.js`)

Mobile-first, single page, works from 320 px wide up to desktop.

1. **Header:** app title + language toggle (`عربي | EN`) fixed in the **top-right corner in both languages**.
2. **Line selector:** three large buttons (A, D, E) showing the line letter and terminus name, colored with the line color. Selected state clearly visible.
3. **From / To:** two `<select>` dropdowns listing only the selected line's stations in line order. The "To" list excludes the chosen "From". A **swap (⇅) button** exchanges them. Changing the line resets both.
4. **Result card:** for the first train, a prominent "in N min" countdown, departure → arrival, duration, train number, and an "Express" badge when applicable. Below it, the 2 following trains in a compact list. Trains from tomorrow are labelled "Tomorrow".
5. **Empty states:** no selection yet; same station chosen; no trains found.
6. **Validity banner:** if today is outside `valid_from`–`valid_to`, show a warning that the timetable may be outdated.
7. **Footer:** "Unofficial app. Timetable: SNCFT Banlieue de Tunis, Winter 2026–2027 (1 Sep 2026 – 30 Jun 2027). Always check at the station." — in the current language.
8. Remember the last line, stations and language in `localStorage` (wrap in try/catch).
9. Accessibility: real `<label>`s, visible focus, sufficient contrast, `aria-live="polite"` on the result area.

### 7.5 Languages (`i18n.js`, `locales/*.json`)
- Default language: **Arabic**. Persist the choice.
- Switching sets `<html lang="ar" dir="rtl">` or `<html lang="en" dir="ltr">` and re-renders all text, including station and line names from the line JSON.
- All UI strings live in `locales/ar.json` and `locales/en.json` (no hard-coded UI text in HTML/JS).
- Use Western digits (0–9) for times in both languages.
- CSS uses logical properties (`margin-inline-start`, etc.) so the layout mirrors correctly; only the language toggle stays pinned top-right.
- Font: see §7.6 (self-hosted Cairo or the system font stack; must work offline).

### 7.6 Visual design — make it beautiful

The owner wants a **polished, modern, beautiful** site whose theme feels **close to SNCFT's visual identity** while staying clearly unofficial.

**Identity (inspired by, not copied):**
- Primary: deep SNCFT-style blue `#0B3C8C`, with a lighter blue `#1E6FD9` for interactive states.
- Line colors from §4.1 (A blue, D orange, E green) are the main accents. The selected line tints the result card, the route strip and the active controls.
- Neutral background `#F5F7FB`, white cards, text `#0F1B33`.
- **Do not** use the SNCFT logo or wordmark, and do not copy the official website's header or layout. The title is the app's own name ("القطار القادم" / "Next Train").

**Look and feel:**
- Clean transit-app aesthetic: generous spacing, rounded cards (16 px radius), soft shadows, clear hierarchy.
- A hero area at the top using the best supplied image (train or station photo) under a blue gradient overlay, with the title and a short tagline. It should be compact on mobile so the form stays above the fold.
- The **countdown** ("in 7 min") is the visual star: large, bold, in the line color.
- A **route strip** under the first result: a vertical line with dots for every station between origin and destination. Stops the train serves are solid dots; stations an express train skips are hollow and greyed out.
- Line selector buttons look like transit line badges: a colored circle with the letter, plus the terminus name.
- Subtle transitions only (150–250 ms) on selection and result updates. Respect `prefers-reduced-motion`.
- **Dark mode** through `prefers-color-scheme`, with the same accents on a dark navy background (`#0A1428`).
- Typography: if you can download **Cairo** (Arabic + Latin, SIL Open Font License) as woff2, self-host it in `public/assets/fonts/` (weights 400, 600, 800). Otherwise use the system font stack. Never load fonts from a CDN at runtime.
- Times use tabular numbers (`font-variant-numeric: tabular-nums`) so the digits don't jump when they update.

**Before finishing,** look at the page at 360 px and 1280 px wide, in both languages and both color schemes, and refine anything that looks unbalanced, cramped or generic.

### 7.7 PWA files
- `manifest.webmanifest` with name, icons, theme color.
- `sw.js`: cache the app shell and JSON for offline use, with a cache version constant.
- **Register the service worker only when `location.hostname` is not `localhost` or `127.0.0.1`,** so caching never interferes with local development.

---

## 8. Tests

### 8.1 Python — `tests/test_build_data.py` (`unittest`)
Run: `python -m unittest discover tests`
- Build succeeds and produces 3 files.
- Each trip's times strictly increase; `0.0` never appears in output.
- Trip counts: line A 59 to_tunis / 60 from_tunis, line D 37 / 36, line E 60 / 60.

### 8.2 JavaScript — `tests/search.test.mjs` (`node:test`, Node 18+, no packages)
Run: `node --test tests/`
If Node is not installed, skip these and say so; the browser checks in §10 still apply.

Load the generated JSON + `holidays.json` from disk and assert these **exact** results (train, depart, arrive):

| # | Line | From → To | Simulated Tunis time | Expected next 3 |
|---|---|---|---|---|
| 1 | E | Bougatfa → Tunis | Mon 2026-10-12 08:05 | 428 08:20→08:35 · 430 08:40→08:55 · 434 09:00→09:15 |
| 2 | E | Bougatfa → Tunis | Sun 2026-10-11 08:05 | 428 08:20→08:35 · 432 08:50→09:05 · 436 09:20→09:35 |
| 3 | A | Tunis → Bou Kornine | Mon 2026-10-12 16:58 | 213 17:05→17:38 · 215 17:25→17:59 · 219 17:45→18:19 *(express 211 skips Bou Kornine)* |
| 4 | A | Tunis → Hammam Lif | Mon 2026-10-12 16:58 | 211 17:00→17:28 (express) · 213 17:05→17:40 · 215 17:25→18:02 |
| 5 | A | Erriadh → Radès | Mon 2026-10-12 17:20 | 236 17:25→17:54 (express) · 240 17:40→18:14 · 242 18:10→18:44 |
| 6 | D | Gobaa Ville → Tunis | Mon 2026-10-12 22:30 | Tomorrow: 602 05:10→05:41 · 604 05:35→06:07 · 606 06:05→06:37 |
| 7 | D | Tunis → Gobaa Ville | Sat 2026-10-17 23:00 | Tomorrow (Sunday, 601 does not run): 603 04:55→05:25 · 605 05:30→06:00 · 609 06:15→06:45 |
| 8 | D | Tunis → Gobaa Ville | Thu 2026-10-15 04:00 *(holiday)* | 603 04:55→05:25 · 605 05:30→06:00 · 609 06:15→06:45 |
| 9 | A | Tunis → Erriadh | Sat 2026-10-17 07:25 | 131 07:45→08:42 · 133 08:00→08:58 · 135 08:20→09:18 *(125 is "except Saturday")* |

---

## 9. Run locally

The app uses `fetch()` for JSON, so it **must be served over HTTP** — opening `index.html` directly from disk will not work.

```bash
python scripts/build_data.py
python -m unittest discover tests
node --test tests/            # optional, if Node 18+ is installed
python -m http.server 8000 --directory public
```

Then open **http://localhost:8000**.
Test a scenario: http://localhost:8000/?now=2026-10-12T08:05

Write these exact steps in `README.md`, plus a short description of the project and data source.

---

## 10. Definition of done (verify each before finishing)

- [ ] CSVs moved from `data/` to `data/raw/`; images used by the site copied to `public/assets/img/` and optimized; build script generates the 3 line JSON files with no errors.
- [ ] Python tests pass; JS tests pass (or are reported as skipped because Node is missing).
- [ ] Local server runs; page loads at `http://localhost:8000` with no console errors.
- [ ] Each of the 9 scenarios in §8.2 shows the expected trains in the browser via `?now=`.
- [ ] Line switch filters stations; "To" excludes "From"; swap works.
- [ ] Arabic ↔ English toggle switches all text and direction; choice survives reload.
- [ ] Layout works at 360 px width and on desktop; no horizontal scroll.
- [ ] Design matches §7.6 in Arabic/English and light/dark; report of where each image was used.
- [ ] No external network requests (fonts, CDNs, analytics).
- [ ] `.gitignore` covers `__pycache__/`, `.DS_Store`, `node_modules/`.

## 11. Out of scope for Phase 1

Hosting/deployment, custom domain, analytics, GPS, user accounts, real-time delays, push notifications, summer timetable.
