import {
  activePeriod,
  addDays,
  formatMinutes,
  holidayName,
  isHoliday,
  parseOverride,
  ramadanStatus,
  tunisNow,
} from "./calendar.js";
import { nextTrains } from "./search.js";
import { getLang, locale, savedLang, setLang, t } from "./i18n.js";
import { h, renderInto, svg } from "./dom.js";
import { activeAlerts, alertItem, callout, concerns, icon, readAlerts, SEVERITIES } from "./alerts.js";
import { setupInstall } from "./install.js";

const ALL_LINES = ["A", "D", "E"];
const STATE_KEY = "nextTrain.state";
const REFRESH_MS = 30_000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
// Poster paths written by build_data.py, e.g. downloads/winter_2026_2027/horaires-ligne-A-hiver-2026-2027.webp
const DOWNLOAD_PATH = /^downloads\/[a-z0-9_]+\/([A-Za-z0-9-]+\.(jpg|png|webp|pdf))$/;

const $ = (id) => document.getElementById(id);
const el = {
  lines: $("lines"),
  from: $("from"),
  to: $("to"),
  swap: $("swap"),
  result: $("result"),
  notices: $("notices"),
  alerts: $("alerts"),
  critical: $("critical-banner"),
  clock: $("clock"),
  simBadge: $("sim-badge"),
  app: $("app"),
  downloads: $("downloads"),
  downloadList: $("download-list"),
};

const cal = { timetables: [], holidays: {}, overrides: {} };
const lineCache = new Map();
let alerts = { message: null, scheduled: [] };
let lineCodes = [];
const state = { line: "A", from: "", to: "" };
const override = parseOverride(new URLSearchParams(location.search).get("now"));
let lastQueryKey = "";
let refreshSeq = 0;

const now = () => override ?? tunisNow();
const nowKey = (n) => `${n.date}T${formatMinutes(n.minutes)}`;

/* ---------- Data ---------- */

async function fetchJson(path, fresh = false) {
  const res = await fetch(path, fresh ? { cache: "no-cache" } : undefined);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function optionalJson(path, fallback) {
  try {
    return await fetchJson(path, true);
  } catch (err) {
    console.error(`Could not load ${path}; using defaults.`, err);
    return fallback;
  }
}

function ensureLine(periodId, line) {
  const key = `${periodId}/${line}`;
  if (!lineCache.has(key)) {
    const p = fetchJson(`data/${encodeURIComponent(periodId)}/line_${line}.json`)
      .then((d) => {
        lineCache.set(key, d);
        return d;
      })
      .catch((err) => {
        lineCache.delete(key);
        throw err;
      });
    lineCache.set(key, p);
  }
  return lineCache.get(key);
}

function getLine(periodId, line) {
  const d = periodId && lineCache.get(`${periodId}/${line}`);
  return d && !(d instanceof Promise) ? d : null;
}

const lineForDate = (line) => (date) => getLine(activePeriod(date, line, cal).period?.id, line);

async function ensureDay(date, lines) {
  await Promise.all(
    lines.map((line) => {
      const { period } = activePeriod(date, line, cal);
      return period ? ensureLine(period.id, line) : null;
    })
  );
}

/* ---------- State ---------- */

function todayLine(line = state.line) {
  return getLine(activePeriod(now().date, line, cal).period?.id, line);
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    if (lineCodes.includes(s.line)) state.line = s.line;
    const ids = (todayLine()?.stations || []).map((x) => x.id);
    state.from = ids.includes(s.from) ? s.from : "";
    state.to = ids.includes(s.to) && s.to !== state.from ? s.to : "";
  } catch {}
  if (!lineCodes.includes(state.line)) state.line = lineCodes[0];
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

const stationName = (s) => s[getLang()];

/* ---------- Rendering ---------- */

// Poster of the timetable in force today for each line (same choice of period as the train times).
function todayDownloads() {
  return lineCodes
    .map((code) => {
      const d = activePeriod(now().date, code, cal).period?.downloads?.[code];
      const m = d && typeof d.path === "string" && DOWNLOAD_PATH.exec(d.path);
      return m && Number.isFinite(d.bytes) && d.bytes > 0 ? { code, path: d.path, file: m[1], ext: m[2], bytes: d.bytes } : null;
    })
    .filter(Boolean);
}

function fileSize(bytes) {
  const mb = bytes >= 1024 * 1024;
  const n = new Intl.NumberFormat(locale(), { maximumFractionDigits: mb ? 1 : 0 }).format(bytes / (mb ? 1024 * 1024 : 1024));
  return t(mb ? "dl_size_mb" : "dl_size_kb", { n });
}

function renderDownloads() {
  const items = todayDownloads();
  renderInto(el.downloadList, JSON.stringify([getLang(), items]), () =>
    items.map((d) =>
      h(
        "li",
        null,
        h(
          "a",
          { class: "dl-btn", "data-line": d.code, href: d.path, download: d.file },
          h("span", { class: "line-badge", "aria-hidden": "true", text: d.code }),
          h(
            "span",
            { class: "dl-text" },
            h("span", { class: "dl-name", text: t("dl_line", { line: d.code }) }),
            h("span", { class: "dl-meta num" }, h("bdi", { text: fileSize(d.bytes) }), " · ", h("bdi", { text: d.ext.toUpperCase() }))
          ),
          svg([["path", { d: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" }]], { class: "icon dl-icon" })
        )
      )
    )
  );
  el.downloads.hidden = !items.length;
}

function renderLines() {
  el.lines.replaceChildren(
    ...lineCodes.map((code) => {
      const l = todayLine(code);
      if (!l) return null;
      return h(
        "button",
        { type: "button", class: "line-btn", "data-line": code, "aria-pressed": String(code === state.line) },
        h("span", { class: "line-badge", "aria-hidden": "true", text: code }),
        h(
          "span",
          { class: "line-text" },
          h("span", { class: "line-name", text: t("line_label", { line: code }) }),
          h("span", { class: "line-terminus", text: stationName(l.stations[0]) })
        )
      );
    }).filter(Boolean)
  );
  el.app.dataset.line = state.line;
}

function fillSelect(select, stations, value, exclude) {
  select.replaceChildren(
    h("option", { value: "", text: t("select_station") }),
    ...stations.filter((s) => s.id !== exclude).map((s) => h("option", { value: s.id, text: stationName(s) }))
  );
  select.value = value;
}

function renderSelects() {
  const stations = todayLine()?.stations || [];
  fillSelect(el.from, stations, state.from);
  fillSelect(el.to, stations, state.to, state.from);
  el.swap.disabled = !state.from && !state.to;
}

function formatDate(dateStr, opts) {
  return new Intl.DateTimeFormat(locale(), { timeZone: "UTC", ...opts }).format(new Date(`${dateStr}T00:00:00Z`));
}

function formatDateTime(key) {
  const [d, hm] = key.split("T");
  return `${formatDate(d, { day: "numeric", month: "short" })} ${hm}`;
}

function renderClock(n) {
  const day = formatDate(n.date, { weekday: "short", day: "numeric", month: "short" });
  el.clock.textContent = `${day} · ${formatMinutes(n.minutes)}`;
  el.clock.dateTime = nowKey(n);
  el.simBadge.hidden = !override;
}

const alertCtx = () => ({ lang: getLang(), t, formatDateTime });

function renderAlerts(n) {
  const active = activeAlerts(alerts, nowKey(n));
  const list = alerts.message ? active : [null, ...active];
  renderInto(el.alerts, JSON.stringify([getLang(), list]), () => list.map((a) => alertItem(a, alertCtx())));

  const critical = active.filter((a) => a.severity === "critical" && concerns(a, state.line));
  renderInto(el.critical, JSON.stringify([getLang(), critical]), () =>
    critical.length
      ? h("div", { class: "wrap critical-inner" }, icon("critical"), h("div", null, critical.map((a) => h("p", { text: a[getLang()] }))))
      : []
  );
  el.critical.hidden = !critical.length;
  return active.filter((a) => a.severity !== "info" && concerns(a, state.line));
}

function renderNotices(n, prominentAlerts) {
  const { period, fallbackReason } = activePeriod(n.date, state.line, cal);
  const lang = getLang();
  const hol = isHoliday(n.date, cal) ? holidayName(n.date, cal) : null;
  const holText = hol ? t("holiday_today", { name: hol.key ? t(`hol_${hol.key}`) : hol[lang] }) : null;
  const notes = prominentAlerts
    .sort((x, y) => SEVERITIES.indexOf(y.severity) - SEVERITIES.indexOf(x.severity))
    .map((a) => [a.severity, a[lang]]);

  if (fallbackReason?.code === "missing") {
    notes.push(["warning", t("fallback_missing", { expected: t(`type_${fallbackReason.expected}`), using: t(`type_${fallbackReason.using}`) })]);
  } else if (fallbackReason?.code === "outdated") {
    notes.push(["warning", t("fallback_outdated", { name: period.name[lang] })]);
  } else if (fallbackReason?.code === "none") {
    notes.push(["warning", t("fallback_none")]);
  }
  const ram = ramadanStatus(n.date, cal.overrides);
  if (ram.startsTomorrow) notes.push(["info", t("ramadan_starts_tomorrow")]);
  if (ram.endsTomorrow) notes.push(["info", t("ramadan_ends_tomorrow")]);
  if ((ram.inRamadan || ram.startsTomorrow) && ram.auto) notes.push(["info", t("ramadan_auto")]);

  const periodName = period ? period.name[lang] : null;
  const changed = renderInto(el.notices, JSON.stringify([periodName, holText, notes]), () => [
    periodName || holText
      ? h(
          "div",
          { class: "pills" },
          periodName ? h("span", { class: "pill" }, icon("calendar"), h("span", { class: "sr-only", text: `${t("timetable")}: ` }), periodName) : null,
          holText ? h("span", { class: "pill pill-holiday" }, icon("star"), holText) : null
        )
      : null,
    notes.map(([severity, text]) => callout(severity, text, t)),
  ]);
  if (changed) el.notices.hidden = !el.notices.childElementCount;
}

function countdown(min) {
  if (min <= 0) return [h("span", { class: "cd-value", text: t("now") })];
  if (min < 60) return [h("span", { class: "cd-value num", text: min }), h("span", { class: "cd-unit", text: t("unit_min") })];
  return [
    h("span", { class: "cd-value num", text: Math.floor(min / 60) }),
    h("span", { class: "cd-unit", text: t("unit_h") }),
    h("span", { class: "cd-value num", text: String(min % 60).padStart(2, "0") }),
    h("span", { class: "cd-unit", text: t("unit_min") }),
  ];
}

const hm = (min) => ({ h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
const durationText = (min) => (min < 60 ? t("dur_min", { n: min }) : t("dur_h_min", hm(min)));
const inText = (min) => (min <= 0 ? t("now") : min < 60 ? t("in_min", { n: min }) : t("in_h_min", hm(min)));
const arrow = () => svg([["path", { d: "M4 12h15m0 0-5-5m5 5-5 5" }]], { class: "arrow" });
const timeEl = (min, cls) => h("time", { class: cls, text: formatMinutes(min) });

function badges(r) {
  return [
    r.tomorrow ? h("span", { class: "badge badge-tomorrow", text: t("tomorrow") }) : null,
    r.express ? h("span", { class: "badge badge-express", text: t("express") }) : null,
  ];
}

function route(r, stations, oIdx, dIdx) {
  const times = new Map(r.served);
  const step = oIdx < dIdx ? 1 : -1;
  const items = [];
  for (let i = oIdx; i !== dIdx + step; i += step) {
    const served = times.has(i);
    const end = i === oIdx || i === dIdx;
    items.push(
      h(
        "li",
        { class: `stop${served ? "" : " skip"}${end ? " end" : ""}` },
        h("span", { class: "dot", "aria-hidden": "true" }),
        h("span", { class: "stop-name", text: stationName(stations[i]) }),
        served ? timeEl(times.get(i), "num") : h("span", { class: "skip-label", text: t("skipped") })
      )
    );
  }
  return h("details", { class: "route", open: true }, h("summary", { text: t("route") }), h("ol", { class: "route-list" }, items));
}

const EMPTY_ICONS = {
  select: [["path", { d: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" }], ["circle", { cx: 12, cy: 9.5, r: 2.5 }]],
  same: [["circle", { cx: 12, cy: 12, r: 8 }], ["path", { d: "M8 12h8" }]],
  none: [["circle", { cx: 12, cy: 12, r: 8 }], ["path", { d: "M12 7.5V12l3 2" }]],
};

function empty(kind) {
  return h("div", { class: "empty" }, svg(EMPTY_ICONS[kind]), h("h2", { text: t(`empty_${kind}_title`) }), h("p", { text: t(`empty_${kind}`) }));
}

function resultNodes(results) {
  const [first, ...rest] = results;
  const ld = getLine(first.period, state.line);
  const ids = ld.stations.map((s) => s.id);
  const oIdx = ids.indexOf(state.from);
  const dIdx = ids.indexOf(state.to);
  const nodes = [
    h(
      "article",
      { class: "next" },
      h("header", { class: "next-head" }, h("h2", { class: "section-label", text: t("next_train") }), h("div", { class: "badges" }, badges(first))),
      h("p", { class: "countdown" }, h("span", { class: "cd-label", text: t("departs_in") }), h("span", { class: "cd-num" }, countdown(first.minutesUntil))),
      h(
        "div",
        { class: "times" },
        h("div", { class: "time-block" }, timeEl(first.depart, "num"), h("span", { text: stationName(ld.stations[oIdx]) })),
        arrow(),
        h("div", { class: "time-block" }, timeEl(first.arrive, "num"), h("span", { text: stationName(ld.stations[dIdx]) }))
      ),
      h(
        "dl",
        { class: "meta" },
        h("div", null, h("dt", { text: t("duration") }), h("dd", { class: "num", text: durationText(first.durationMin) })),
        h("div", null, h("dt", { class: "sr-only", text: t("train_no", { n: "" }) }), h("dd", { class: "train-no num", text: t("train_no", { n: first.train }) }))
      ),
      route(first, ld.stations, oIdx, dIdx)
    ),
  ];
  if (rest.length) {
    nodes.push(
      h("h3", { class: "section-label later-title", text: t("later") }),
      h(
        "ul",
        { class: "later" },
        rest.map((r) =>
          h(
            "li",
            null,
            h("span", { class: "later-times num" }, timeEl(r.depart), arrow(), timeEl(r.arrive)),
            h(
              "span",
              { class: "later-meta" },
              h("span", { class: "num", text: t("train_no", { n: r.train }) }),
              " · ",
              h("span", { class: "num", text: durationText(r.durationMin) }),
              badges(r)
            ),
            h("span", { class: "later-in num", text: inText(r.minutesUntil) })
          )
        )
      )
    );
  }
  return nodes;
}

function renderResult(n) {
  const query = `${getLang()}|${state.line}|${state.from}|${state.to}`;
  const animate = query !== lastQueryKey;
  lastQueryKey = query;

  let kind = null;
  let results = [];
  if (!state.from || !state.to) kind = "select";
  else if (state.from === state.to) kind = "same";
  else {
    results = nextTrains(lineForDate(state.line), cal, state.from, state.to, n);
    if (!results.length) kind = "none";
  }
  renderInto(el.result, JSON.stringify([query, kind, results]), () => (kind ? empty(kind) : resultNodes(results)));
  if (animate) {
    el.result.classList.remove("enter");
    void el.result.offsetWidth;
    el.result.classList.add("enter");
  }
}

async function refresh() {
  const seq = ++refreshSeq;
  const n = now();
  try {
    await Promise.all([ensureDay(n.date, lineCodes), ensureDay(addDays(n.date, 1), [state.line])]);
  } catch (err) {
    console.error(err);
  }
  if (seq !== refreshSeq) return;
  renderClock(n);
  renderNotices(n, renderAlerts(n));
  renderResult(n);
}

async function renderAll() {
  await ensureDay(now().date, lineCodes).catch((err) => console.error(err));
  renderLines();
  renderSelects();
  renderDownloads();
  for (const b of document.querySelectorAll(".lang-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  await refresh();
}

function bind() {
  el.lines.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-line]");
    if (!btn || btn.dataset.line === state.line) return;
    Object.assign(state, { line: btn.dataset.line, from: "", to: "" });
    saveState();
    renderAll();
  });
  el.from.addEventListener("change", () => {
    state.from = el.from.value;
    if (state.to === state.from) state.to = "";
    saveState();
    renderSelects();
    refresh();
  });
  el.to.addEventListener("change", () => {
    state.to = el.to.value;
    saveState();
    refresh();
  });
  el.swap.addEventListener("click", () => {
    [state.from, state.to] = [state.to, state.from];
    saveState();
    renderSelects();
    refresh();
  });
  for (const b of document.querySelectorAll(".lang-toggle button")) {
    b.addEventListener("click", async () => {
      if (b.dataset.lang === getLang()) return;
      await setLang(b.dataset.lang);
      renderAll();
    });
  }
  let lastDate = now().date;
  setInterval(() => {
    const d = now().date;
    if (d !== lastDate) {
      lastDate = d;
      renderAll();
    } else refresh();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderAll();
  });
}

function showLoadError() {
  el.result.replaceChildren(h("p", { class: "empty", text: t("load_error") }));
}

async function init() {
  const langReady = setLang(savedLang());
  try {
    const [timetables, holidays, overrides, alertData] = await Promise.all([
      fetchJson("data/timetables.json", true),
      optionalJson("data/holidays.json", {}),
      optionalJson("data/overrides.json", {}),
      optionalJson("data/alerts.json", null),
    ]);
    if (!Array.isArray(timetables)) throw new Error("data/timetables.json: expected a list");
    Object.assign(cal, {
      timetables: timetables.filter((p) => p && typeof p.id === "string" && /^[a-z0-9_]+$/.test(p.id) && Array.isArray(p.lines)),
      holidays: holidays && typeof holidays === "object" ? holidays : {},
      overrides: overrides && typeof overrides === "object" ? overrides : {},
    });
    alerts = readAlerts(alertData);
    lineCodes = ALL_LINES.filter((c) => cal.timetables.some((p) => p.lines.includes(c)));
    await langReady;
    await ensureDay(now().date, lineCodes);
  } catch (err) {
    console.error(err);
    await langReady.catch(() => {});
    showLoadError();
    return;
  }
  loadState();
  bind();
  setupInstall();
  await renderAll();
  document.body.classList.add("ready");
}

// Owner kill switch: data/sw-kill.json with {"kill": true} removes the service worker and every cache.
async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let kill = false;
  try {
    const res = await fetch("data/sw-kill.json", { cache: "no-store" });
    if (res.ok) kill = (await res.json())?.kill === true;
  } catch {}
  if (kill) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    if (hadController && !sessionStorage.getItem("nextTrain.killed")) {
      sessionStorage.setItem("nextTrain.killed", "1");
      location.reload();
    }
    return;
  }
  if (!LOCAL_HOSTS.includes(location.hostname)) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
setupServiceWorker();
