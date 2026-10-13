import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextTrains } from "../public/js/search.js";
import {
  activePeriod,
  formatMinutes,
  isHoliday,
  isRamadan,
  parseOverride,
  ramadanStatus,
  runsOn,
} from "../public/js/calendar.js";

const dataDir = new URL("../public/data/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(name, dataDir)), "utf8"));
const WINTER = "winter_2026_2027";
const winter = { A: load(`${WINTER}/line_A.json`), D: load(`${WINTER}/line_D.json`), E: load(`${WINTER}/line_E.json`) };
const holidays = load("holidays.json");
const defaultOverrides = load("overrides.json");
const winterIndex = load("timetables.json").filter((p) => p.id === WINTER);

const makeCal = (extra = {}) => ({ holidays, overrides: defaultOverrides, timetables: winterIndex, ...extra });

// Fixture: a fake Ramadan 2027 timetable for line E, with train numbers +9000 so the source is obvious.
const ramadanE = {
  ...winter.E,
  period: "ramadan_2027",
  trips: winter.E.trips.map((t) => ({ ...t, train: t.train + 9000, stops: t.stops.map(([s, m]) => [s, m + 30]) })),
};
const ramadanPeriod = {
  id: "ramadan_2027", type: "ramadan", priority: 3, hijri_year: 1448, valid_from: null, valid_to: null, lines: ["E"],
  name: { ar: "توقيت رمضان 2027", en: "Ramadan timetable 2027" },
};
const store = { [WINTER]: winter, ramadan_2027: { E: ramadanE } };
const resolver = (cal, line) => (date) => {
  const { period } = activePeriod(date, line, cal);
  return period ? store[period.id]?.[line] ?? null : null;
};
const fmt = (res) => res.map((r) => `${r.train} ${formatMinutes(r.depart)} ${formatMinutes(r.arrive)}`);

const scenarios = [
  { n: 1, line: "E", from: "bougatfa", to: "tunis", now: "2026-10-12T08:05",
    expect: ["428 08:20 08:35", "430 08:40 08:55", "434 09:00 09:15"] },
  { n: 2, line: "E", from: "bougatfa", to: "tunis", now: "2026-10-11T08:05",
    expect: ["428 08:20 08:35", "432 08:50 09:05", "436 09:20 09:35"] },
  { n: 3, line: "A", from: "tunis", to: "bou-kornine", now: "2026-10-12T16:58",
    expect: ["213 17:05 17:38", "215 17:25 17:59", "219 17:45 18:19"] },
  { n: 4, line: "A", from: "tunis", to: "hammam-lif", now: "2026-10-12T16:58",
    expect: ["211 17:00 17:28", "213 17:05 17:40", "215 17:25 18:02"], express: [true, false, false] },
  { n: 5, line: "A", from: "erriadh", to: "rades", now: "2026-10-12T17:20",
    expect: ["236 17:25 17:54", "240 17:40 18:14", "242 18:10 18:44"], express: [true, false, false] },
  { n: 6, line: "D", from: "gobaa-ville", to: "tunis", now: "2026-10-12T22:30",
    expect: ["602 05:10 05:41", "604 05:35 06:07", "606 06:05 06:37"], tomorrow: true },
  { n: 7, line: "D", from: "tunis", to: "gobaa-ville", now: "2026-10-17T23:00",
    expect: ["603 04:55 05:25", "605 05:30 06:00", "609 06:15 06:45"], tomorrow: true },
  { n: 8, line: "D", from: "tunis", to: "gobaa-ville", now: "2026-10-15T04:00",
    expect: ["603 04:55 05:25", "605 05:30 06:00", "609 06:15 06:45"], tomorrow: false },
  { n: 9, line: "A", from: "tunis", to: "erriadh", now: "2026-10-17T07:25",
    expect: ["131 07:45 08:42", "133 08:00 08:58", "135 08:20 09:18"] },
];

for (const s of scenarios) {
  test(`scenario ${s.n}: line ${s.line} ${s.from} → ${s.to} at ${s.now}`, () => {
    const cal = makeCal();
    const res = nextTrains(resolver(cal, s.line), cal, s.from, s.to, parseOverride(s.now));
    assert.deepEqual(fmt(res), s.expect);
    if (s.express) assert.deepEqual(res.map((r) => r.express), s.express);
    if (s.tomorrow !== undefined) assert.ok(res.every((r) => r.tomorrow === s.tomorrow));
    for (const r of res) {
      assert.equal(r.durationMin, r.arrive - r.depart);
      assert.ok(r.minutesUntil >= 0);
      assert.equal(r.period, WINTER);
    }
  });
}

test("same origin and destination returns nothing", () => {
  assert.deepEqual(nextTrains(winter.E, makeCal(), "tunis", "tunis", parseOverride("2026-10-12T08:00")), []);
});

test("express 211 never offered for Tunis → Bou Kornine", () => {
  const res = nextTrains(winter.A, makeCal(), "tunis", "bou-kornine", parseOverride("2026-10-12T16:58"));
  assert.ok(!res.some((r) => r.train === 211));
});

test("service rules", () => {
  const cal = makeCal();
  assert.equal(runsOn("no_sun_hol", "2026-10-15", cal), false);
  assert.equal(runsOn("sun_hol_only", "2026-10-15", cal), true);
  assert.equal(runsOn("no_sat", "2026-10-17", cal), false);
  assert.equal(runsOn("no_sat_sun_hol", "2026-10-16", cal), true);
  assert.equal(runsOn("no_sat_sun_hol", "2026-10-17", cal), false);
  assert.equal(runsOn("daily", "2026-10-11", cal), true);
});

test("parseOverride rejects malformed values", () => {
  assert.equal(parseOverride("2026-10-12 08:05"), null);
  assert.equal(parseOverride("2026-10-12T25:00"), null);
  assert.equal(parseOverride("2026-02-30T08:00"), null);
  assert.deepEqual(parseOverride("2026-10-12T08:05"), { date: "2026-10-12", minutes: 485 });
});

test("Ramadan detection: 2027-02-20 is Ramadan, 2026-10-12 is not", () => {
  assert.equal(isRamadan("2027-02-20", defaultOverrides), true);
  assert.equal(isRamadan("2026-10-12", defaultOverrides), false);
  assert.equal(ramadanStatus("2027-02-20", defaultOverrides).auto, true);
});

test("Ramadan notices on the day before the start and the last day", () => {
  const start = ramadanStatus("2027-02-08", defaultOverrides).range.start;
  const end = ramadanStatus("2027-02-20", defaultOverrides).range.end;
  const dayBefore = new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  assert.equal(ramadanStatus(dayBefore, defaultOverrides).startsTomorrow, true);
  assert.equal(ramadanStatus(end, defaultOverrides).endsTomorrow, true);
  assert.equal(ramadanStatus("2027-02-20", defaultOverrides).endsTomorrow, false);
});

test("Ramadan override: start 2027-02-09 makes 2027-02-08 not Ramadan, and only for that year", () => {
  const overrides = { ...defaultOverrides, ramadan: { start: "2027-02-09", end: null } };
  assert.equal(isRamadan("2027-02-08", overrides), false);
  assert.equal(isRamadan("2027-02-09", overrides), true);
  assert.equal(ramadanStatus("2027-02-20", overrides).range.autoStart, false);
  assert.equal(ramadanStatus("2028-02-10", overrides).range.autoStart, true);
  assert.deepEqual(ramadanStatus("2028-02-10", overrides).range, ramadanStatus("2028-02-10", defaultOverrides).range);
});

test("fallback: Ramadan date without Ramadan data uses winter with a fallbackReason", () => {
  const { period, fallbackReason } = activePeriod("2027-02-20", "A", makeCal());
  assert.equal(period.id, WINTER);
  assert.deepEqual(fallbackReason, { code: "missing", expected: "ramadan", using: "winter" });
  assert.equal(activePeriod("2026-10-12", "A", makeCal()).fallbackReason, null);
});

test("fallback: summer without summer data, and dates after every timetable", () => {
  const july = activePeriod("2027-07-10", "E", makeCal());
  assert.equal(july.period.id, WINTER);
  assert.deepEqual(july.fallbackReason, { code: "missing", expected: "summer", using: "winter" });
  const sept = activePeriod("2027-09-10", "E", makeCal());
  assert.equal(sept.period.id, WINTER);
  assert.equal(sept.fallbackReason.code, "outdated");
});

test("priority: Ramadan data wins over winter, only for the lines it has", () => {
  const cal = makeCal({ timetables: [...winterIndex, ramadanPeriod] });
  assert.equal(activePeriod("2027-02-20", "E", cal).period.id, "ramadan_2027");
  assert.equal(activePeriod("2027-02-20", "E", cal).fallbackReason, null);
  assert.equal(activePeriod("2027-02-20", "A", cal).period.id, WINTER);
  assert.equal(activePeriod("2027-02-20", "A", cal).fallbackReason.code, "missing");
  assert.equal(activePeriod("2027-03-15", "E", cal).period.id, WINTER);
  const res = nextTrains(resolver(cal, "E"), cal, "bougatfa", "tunis", parseOverride("2027-02-20T08:05"));
  assert.ok(res.length === 3 && res.every((r) => r.train > 9000 && r.period === "ramadan_2027"));
});

test("tomorrow across a boundary: last day of Ramadan at 23:00 gets winter trains", () => {
  const cal = makeCal({ timetables: [...winterIndex, ramadanPeriod] });
  const last = ramadanStatus("2027-02-20", cal.overrides).range.end;
  const res = nextTrains(resolver(cal, "E"), cal, "bougatfa", "tunis", parseOverride(`${last}T23:00`));
  assert.equal(res.length, 3);
  assert.ok(res.every((r) => r.tomorrow && r.period === WINTER && r.train < 9000));
  const before = nextTrains(resolver(cal, "E"), cal, "bougatfa", "tunis", parseOverride("2027-03-01T23:00"));
  assert.ok(before.every((r) => r.tomorrow && r.period === "ramadan_2027"));
});

test("Eid al-Fitr is an automatic holiday: B-code trains run, A-code trains do not", () => {
  const cal = makeCal();
  const eid = "2027-03-09";
  assert.equal(isHoliday(eid, cal), true);
  assert.equal(isHoliday("2027-03-10", cal), true);
  assert.equal(isHoliday("2027-03-11", cal), false);
  assert.equal(runsOn("sun_hol_only", eid, cal), true);
  assert.equal(runsOn("no_sun_hol", eid, cal), false);
  const res = nextTrains(resolver(cal, "E"), cal, "bougatfa", "tunis", parseOverride(`${eid}T08:05`));
  assert.deepEqual(fmt(res), ["428 08:20 08:35", "432 08:50 09:05", "436 09:20 09:35"]);
});

test("other religious and fixed holidays", () => {
  const cal = makeCal();
  assert.equal(isHoliday("2027-05-16", cal), true);
  assert.equal(isHoliday("2027-05-17", cal), true);
  assert.equal(isHoliday("2027-06-06", cal), true);
  assert.equal(isHoliday("2026-08-25", cal), true);
  assert.equal(isHoliday("2026-10-15", cal), true);
  assert.equal(isHoliday("2027-10-15", cal), true);
  assert.equal(isHoliday("2027-07-25", cal), true);
  assert.equal(isHoliday("2026-10-12", cal), false);
});

test("Eid override and Ramadan end override move Eid al-Fitr", () => {
  const eidOv = makeCal({ overrides: { ...defaultOverrides, eid_al_fitr: { start: "2027-03-10", end: null } } });
  assert.equal(isHoliday("2027-03-09", eidOv), false);
  assert.equal(isHoliday("2027-03-10", eidOv), true);
  assert.equal(isHoliday("2027-03-11", eidOv), true);
  const ramOv = makeCal({ overrides: { ...defaultOverrides, ramadan: { start: null, end: "2027-03-09" } } });
  assert.equal(isRamadan("2027-03-09", ramOv.overrides), true);
  assert.equal(isHoliday("2027-03-09", ramOv), false);
  assert.equal(isHoliday("2027-03-10", ramOv), true);
});

test("period date override in overrides.json", () => {
  const cal = makeCal({ overrides: { ...defaultOverrides, periods: { [WINTER]: { valid_from: "2026-09-01", valid_to: "2027-06-15" } } } });
  assert.equal(activePeriod("2027-06-10", "A", cal).fallbackReason, null);
  assert.equal(activePeriod("2027-06-20", "A", cal).fallbackReason.code, "outdated");
});
