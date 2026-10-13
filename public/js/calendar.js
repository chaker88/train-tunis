export const TZ = "Africa/Tunis";
export const PRIORITY = { winter: 1, summer: 2, ramadan: 3 };

const pad = (n) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const toDays = (s) => Date.parse(`${s}T00:00:00Z`) / DAY_MS;
const fromDays = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function formatMinutes(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function tunisNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function parseOverride(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!m) return null;
  const [h, min] = [Number(m[2]), Number(m[3])];
  if (h > 23 || min > 59 || fromDays(toDays(m[1])) !== m[1]) return null;
  return { date: m[1], minutes: h * 60 + min };
}

export function addDays(dateStr, n) {
  return fromDays(toDays(dateStr) + n);
}

export function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/* ---------- Islamic (Hijri) calendar ---------- */

const ISLAMIC_FORMAT = (() => {
  for (const cal of ["islamic-umalqura", "islamic-civil", "islamic"]) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" });
      if (f.resolvedOptions().calendar === cal) return f;
    } catch {}
  }
  return null;
})();

const tabularJdn = (y, m, d) => d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439;

function tabularHijri(dateStr) {
  const jd = toDays(dateStr) + 2440588;
  const year = Math.floor((30 * (jd - 1948440) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jd - 29 - tabularJdn(year, 1, 1)) / 29.5) + 1);
  return { year, month, day: jd - tabularJdn(year, month, 1) + 1 };
}

const hijriCache = new Map();
export function hijri(dateStr) {
  let h = hijriCache.get(dateStr);
  if (!h) {
    if (ISLAMIC_FORMAT) {
      const p = Object.fromEntries(ISLAMIC_FORMAT.formatToParts(new Date(`${dateStr}T12:00:00Z`)).map((x) => [x.type, x.value]));
      h = { year: parseInt(p.year, 10), month: parseInt(p.month, 10), day: parseInt(p.day, 10) };
    } else {
      h = tabularHijri(dateStr);
    }
    hijriCache.set(dateStr, h);
  }
  return h;
}

function findHijriDate(year, month, day) {
  const estimate = tabularJdn(year, month, day) - 2440588;
  for (const delta of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const s = fromDays(estimate + delta);
    const h = hijri(s);
    if (h.year === year && h.month === month && h.day === day) return s;
  }
  return fromDays(estimate);
}

const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromDays(toDays(v)) === v;
const near = (a, b) => Math.abs(toDays(a) - toDays(b)) <= 20;

// An override only applies to the occurrence it is close to, so last year's dates never leak into this year.
function resolveRange(auto, ov, keepLength) {
  const s = validDate(ov?.start) && near(ov.start, auto.start) ? ov.start : null;
  const e = validDate(ov?.end) && near(ov.end, auto.end) ? ov.end : null;
  const start = s ?? auto.start;
  let end = e ?? auto.end;
  if (keepLength && s && !e) end = addDays(s, toDays(auto.end) - toDays(auto.start));
  if (end < start) end = start;
  return { start, end, autoStart: !s, autoEnd: !e };
}

const memo = new WeakMap();
const NO_OVERRIDES = {};
function cached(overrides, key, fn) {
  const owner = overrides || NO_OVERRIDES;
  let m = memo.get(owner);
  if (!m) memo.set(owner, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}

export function ramadanRange(hijriYear, overrides) {
  return cached(overrides, `ramadan|${hijriYear}`, () => {
    const auto = { start: findHijriDate(hijriYear, 9, 1), end: addDays(findHijriDate(hijriYear, 10, 1), -1) };
    return { hijriYear, ...resolveRange(auto, overrides?.ramadan, false) };
  });
}

export function religiousHolidays(hijriYear, overrides) {
  return cached(overrides, `holidays|${hijriYear}`, () => {
    const fitrStart = addDays(ramadanRange(hijriYear, overrides).end, 1);
    const adhaStart = findHijriDate(hijriYear, 12, 10);
    const newYear = findHijriDate(hijriYear, 1, 1);
    const mawlid = findHijriDate(hijriYear, 3, 12);
    return {
      eid_al_fitr: resolveRange({ start: fitrStart, end: addDays(fitrStart, 1) }, overrides?.eid_al_fitr, true),
      eid_al_adha: resolveRange({ start: adhaStart, end: addDays(adhaStart, 1) }, overrides?.eid_al_adha, true),
      islamic_new_year: { start: newYear, end: newYear },
      mawlid: { start: mawlid, end: mawlid },
    };
  });
}

export function religiousHoliday(dateStr, overrides) {
  const events = religiousHolidays(hijri(dateStr).year, overrides);
  return Object.keys(events).find((k) => events[k].start <= dateStr && dateStr <= events[k].end) || null;
}

export function ramadanStatus(dateStr, overrides) {
  const r = ramadanRange(hijri(dateStr).year, overrides);
  const inRamadan = r.start <= dateStr && dateStr <= r.end;
  return {
    inRamadan,
    range: r,
    auto: r.autoStart || r.autoEnd,
    startsTomorrow: !inRamadan && r.autoStart && addDays(dateStr, 1) === r.start,
    endsTomorrow: inRamadan && r.autoEnd && dateStr === r.end,
  };
}

export function isRamadan(dateStr, overrides) {
  return ramadanStatus(dateStr, overrides).inRamadan;
}

/* ---------- Holidays and service days ---------- */

export function isHoliday(dateStr, cal) {
  return cached(cal?.overrides, `holiday|${dateStr}|${holidayKey(cal?.holidays)}`, () => {
    const h = cal?.holidays || {};
    const md = dateStr.slice(5);
    if ((h.fixed || []).some((x) => x.month_day === md)) return true;
    if ((h.dates || h.holidays || []).some((x) => x.date === dateStr)) return true;
    return religiousHoliday(dateStr, cal?.overrides) !== null;
  });
}

// Returns { key } for a religious holiday (name from the locale files), { en, ar } for a listed one, or null.
export function holidayName(dateStr, cal) {
  const h = cal?.holidays || {};
  const listed = (h.fixed || []).find((x) => x.month_day === dateStr.slice(5)) || (h.dates || []).find((x) => x.date === dateStr);
  if (listed) return { en: listed.name_en, ar: listed.name_ar };
  const key = religiousHoliday(dateStr, cal?.overrides);
  return key ? { key } : null;
}

const holidayIds = new WeakMap();
let holidaySeq = 0;
function holidayKey(h) {
  if (!h) return 0;
  if (!holidayIds.has(h)) holidayIds.set(h, ++holidaySeq);
  return holidayIds.get(h);
}

export function runsOn(service, dateStr, cal) {
  const dow = dayOfWeek(dateStr);
  const sunOrHol = dow === 0 || isHoliday(dateStr, cal);
  switch (service) {
    case "daily":
      return true;
    case "no_sun_hol":
      return !sunOrHol;
    case "sun_hol_only":
      return sunOrHol;
    case "no_sat_sun_hol":
      return !sunOrHol && dow !== 6;
    case "no_sat":
      return dow !== 6;
    default:
      return false;
  }
}

/* ---------- Timetable periods ---------- */

export function periodRange(period, overrides) {
  const ov = overrides?.periods?.[period.id];
  const from = validDate(ov?.valid_from) ? ov.valid_from : period.valid_from;
  const to = validDate(ov?.valid_to) ? ov.valid_to : period.valid_to;
  if (period.type === "ramadan" && (!from || !to)) {
    const r = ramadanRange(period.hijri_year, overrides);
    return { from: from || r.start, to: to || r.end };
  }
  return { from, to };
}

export function expectedType(dateStr, overrides) {
  if (isRamadan(dateStr, overrides)) return "ramadan";
  const month = Number(dateStr.slice(5, 7));
  return month === 7 || month === 8 ? "summer" : "winter";
}

export function activePeriod(dateStr, line, cal) {
  const overrides = cal?.overrides;
  const periods = (cal?.timetables || [])
    .filter((p) => p.lines.includes(line))
    .map((p) => ({ p, r: periodRange(p, overrides) }))
    .filter((x) => x.r.from && x.r.to);
  if (!periods.length) return { period: null, fallbackReason: { code: "none" } };

  const expected = expectedType(dateStr, overrides);
  const covering = periods
    .filter((x) => x.r.from <= dateStr && dateStr <= x.r.to)
    .sort((a, b) => b.p.priority - a.p.priority || b.r.from.localeCompare(a.r.from));
  if (covering.length) {
    const period = covering[0].p;
    const missing = (PRIORITY[period.type] ?? 0) < PRIORITY[expected];
    return { period, fallbackReason: missing ? { code: "missing", expected, using: period.type } : null };
  }

  const regular = periods.filter((x) => x.p.type !== "ramadan");
  const pool = regular.length ? regular : periods;
  const past = pool.filter((x) => x.r.from <= dateStr).sort((a, b) => b.r.from.localeCompare(a.r.from));
  const pick = past[0] || pool.sort((a, b) => a.r.from.localeCompare(b.r.from))[0];
  const code = pick.p.type === expected ? "outdated" : "missing";
  return { period: pick.p, fallbackReason: { code, expected, using: pick.p.type } };
}
