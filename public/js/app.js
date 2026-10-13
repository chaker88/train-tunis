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

const ALL_LINES = ["A", "D", "E"];
const SEVERITIES = ["info", "warning", "critical"];
const STATE_KEY = "nextTrain.state";
const REFRESH_MS = 30_000;

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
};

const cal = { timetables: [], holidays: {}, overrides: {} };
const lineCache = new Map();
let alerts = { message: null, scheduled: [] };
let lineCodes = [];
const state = { line: "A", from: "", to: "" };
const override = parseOverride(new URLSearchParams(location.search).get("now"));
let lastQueryKey = "";
let refreshSeq = 0;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const now = () => override ?? tunisNow();
const nowKey = (n) => `${n.date}T${formatMinutes(n.minutes)}`;

function setHtml(node, html) {
  if (node.dataset.html !== html) {
    node.innerHTML = html;
    node.dataset.html = html;
  }
}

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
    const p = fetchJson(`data/${periodId}/line_${line}.json`)
      .then((d) => lineCache.set(key, d) && d)
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

function validAlert(a, scheduled) {
  const ok =
    a &&
    typeof a === "object" &&
    SEVERITIES.includes(a.severity) &&
    typeof a.ar === "string" && a.ar.trim() &&
    typeof a.en === "string" && a.en.trim() &&
    (a.lines === undefined || (Array.isArray(a.lines) && a.lines.length && a.lines.every((l) => l === "all" || ALL_LINES.includes(l))));
  if (!ok || !scheduled) return Boolean(ok);
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  return re.test(a.start) && re.test(a.end) && a.start < a.end;
}

function readAlerts(data) {
  const out = { message: null, scheduled: [] };
  if (!data) return out;
  if (validAlert(data.message, false)) out.message = { lines: ["all"], ...data.message };
  else console.error("alerts.json: invalid 'message', showing the default text. Run scripts/validate_alerts.py for details.");
  for (const [i, a] of (Array.isArray(data.scheduled) ? data.scheduled : []).entries()) {
    if (validAlert(a, true)) out.scheduled.push({ lines: ["all"], ...a });
    else console.error(`alerts.json: scheduled alert #${i + 1} is invalid and was skipped.`);
  }
  return out;
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

function renderLines() {
  el.lines.innerHTML = lineCodes
    .map((code) => {
      const l = todayLine(code);
      if (!l) return "";
      return `<button type="button" class="line-btn" data-line="${code}" aria-pressed="${code === state.line}" style="--line:${l.color}">
      <span class="line-badge" aria-hidden="true">${code}</span>
      <span class="line-text">
        <span class="line-name">${esc(t("line_label", { line: code }))}</span>
        <span class="line-terminus">${esc(stationName(l.stations[0]))}</span>
      </span>
    </button>`;
    })
    .join("");
  const l = todayLine();
  if (l) el.app.style.setProperty("--line", l.color);
}

function fillSelect(select, stations, value, exclude) {
  const opts = [`<option value="">${esc(t("select_station"))}</option>`];
  for (const s of stations) {
    if (s.id === exclude) continue;
    opts.push(`<option value="${s.id}"${s.id === value ? " selected" : ""}>${esc(stationName(s))}</option>`);
  }
  select.innerHTML = opts.join("");
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

function renderClock(n) {
  const day = formatDate(n.date, { weekday: "short", day: "numeric", month: "short" });
  el.clock.textContent = `${day} · ${formatMinutes(n.minutes)}`;
  el.clock.dateTime = nowKey(n);
  el.simBadge.hidden = !override;
}

const ICONS = {
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>`,
  warning: `<path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17v.01"/>`,
  critical: `<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2Z"/><path d="M12 7.5v5.5M12 16.5v.01"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  star: `<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z"/>`,
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const alertText = (a) => (a ? a[getLang()] : t("alert_default"));
const concerns = (a, line) => a.lines.includes("all") || a.lines.includes(line);

function activeAlerts(n) {
  const key = nowKey(n);
  const list = alerts.message ? [alerts.message] : [];
  return [...list, ...alerts.scheduled.filter((a) => a.start <= key && key <= a.end)];
}

function callout(severity, text, iconName = severity) {
  return `<div class="callout callout-${severity}">${icon(iconName)}<p><span class="sr-only">${esc(t(`sev_${severity}`))}: </span>${esc(text)}</p></div>`;
}

function formatDateTime(key) {
  const [d, hm] = key.split("T");
  return `${formatDate(d, { day: "numeric", month: "short" })} ${hm}`;
}

function renderAlerts(n) {
  const active = activeAlerts(n);
  const items = (alerts.message ? active : [null, ...active]).map((a) => {
    const severity = a?.severity || "info";
    const meta = [];
    if (a && !a.lines.includes("all")) meta.push(t("alert_lines", { lines: a.lines.join(" · ") }));
    if (a?.end) meta.push(t("alert_until", { when: formatDateTime(a.end) }));
    return `<li class="alert alert-${severity}">
      ${icon(severity)}
      <div><p><span class="sr-only">${esc(t(`sev_${severity}`))}: </span>${esc(alertText(a))}</p>
      ${meta.length ? `<p class="alert-meta num">${esc(meta.join(" — "))}</p>` : ""}</div>
    </li>`;
  });
  setHtml(el.alerts, items.join(""));

  const critical = active.filter((a) => a.severity === "critical" && concerns(a, state.line));
  setHtml(
    el.critical,
    critical.length ? `<div class="wrap critical-inner">${icon("critical")}<div>${critical.map((a) => `<p>${esc(alertText(a))}</p>`).join("")}</div></div>` : ""
  );
  el.critical.hidden = !critical.length;
  return active.filter((a) => a.severity !== "info" && concerns(a, state.line));
}

function renderNotices(n, prominentAlerts) {
  const parts = [];
  const { period, fallbackReason } = activePeriod(n.date, state.line, cal);
  const pills = [];
  if (period) pills.push(`<span class="pill">${icon("calendar")}<span class="sr-only">${esc(t("timetable"))}: </span>${esc(period.name[getLang()])}</span>`);
  const hol = isHoliday(n.date, cal) ? holidayName(n.date, cal) : null;
  if (hol) pills.push(`<span class="pill pill-holiday">${icon("star")}${esc(t("holiday_today", { name: hol.key ? t(`hol_${hol.key}`) : hol[getLang()] }))}</span>`);
  if (pills.length) parts.push(`<div class="pills">${pills.join("")}</div>`);

  for (const a of prominentAlerts.sort((x, y) => SEVERITIES.indexOf(y.severity) - SEVERITIES.indexOf(x.severity))) {
    parts.push(callout(a.severity, alertText(a)));
  }
  if (fallbackReason?.code === "missing") {
    parts.push(callout("warning", t("fallback_missing", { expected: t(`type_${fallbackReason.expected}`), using: t(`type_${fallbackReason.using}`) })));
  } else if (fallbackReason?.code === "outdated") {
    parts.push(callout("warning", t("fallback_outdated", { name: period.name[getLang()] })));
  } else if (fallbackReason?.code === "none") {
    parts.push(callout("warning", t("fallback_none")));
  }

  const ram = ramadanStatus(n.date, cal.overrides);
  if (ram.startsTomorrow) parts.push(callout("info", t("ramadan_starts_tomorrow")));
  if (ram.endsTomorrow) parts.push(callout("info", t("ramadan_ends_tomorrow")));
  if ((ram.inRamadan || ram.startsTomorrow) && ram.auto) parts.push(callout("info", t("ramadan_auto")));

  setHtml(el.notices, parts.join(""));
  el.notices.hidden = !parts.length;
}

function countdownHtml(min) {
  if (min <= 0) return `<span class="cd-value">${esc(t("now"))}</span>`;
  if (min < 60) return `<span class="cd-value num">${min}</span><span class="cd-unit">${esc(t("unit_min"))}</span>`;
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return `<span class="cd-value num">${h}</span><span class="cd-unit">${esc(t("unit_h"))}</span>
    <span class="cd-value num">${m}</span><span class="cd-unit">${esc(t("unit_min"))}</span>`;
}

function durationText(min) {
  return min < 60 ? t("dur_min", { n: min }) : t("dur_h_min", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
}

function inText(min) {
  if (min <= 0) return t("now");
  return min < 60 ? t("in_min", { n: min }) : t("in_h_min", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
}

const ARROW = `<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m0 0-5-5m5 5-5 5"/></svg>`;

function badges(r) {
  return [
    r.tomorrow ? `<span class="badge badge-tomorrow">${esc(t("tomorrow"))}</span>` : "",
    r.express ? `<span class="badge badge-express">${esc(t("express"))}</span>` : "",
  ].join("");
}

function routeHtml(r, stations, oIdx, dIdx) {
  const times = new Map(r.served);
  const step = oIdx < dIdx ? 1 : -1;
  const items = [];
  for (let i = oIdx; i !== dIdx + step; i += step) {
    const end = i === oIdx || i === dIdx;
    const served = times.has(i);
    items.push(`<li class="stop${served ? "" : " skip"}${end ? " end" : ""}">
      <span class="dot" aria-hidden="true"></span>
      <span class="stop-name">${esc(stationName(stations[i]))}</span>
      ${served ? `<time class="num">${formatMinutes(times.get(i))}</time>` : `<span class="skip-label">${esc(t("skipped"))}</span>`}
    </li>`);
  }
  return `<details class="route" open>
    <summary>${esc(t("route"))}</summary>
    <ol class="route-list">${items.join("")}</ol>
  </details>`;
}

function emptyHtml(kind) {
  const icons = {
    select: `<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>`,
    same: `<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>`,
    none: `<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>`,
  };
  return `<div class="empty">
    <svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>
    <h2>${esc(t(`empty_${kind}_title`))}</h2>
    <p>${esc(t(`empty_${kind}`))}</p>
  </div>`;
}

function renderResult(n) {
  const key = `${getLang()}|${state.line}|${state.from}|${state.to}`;
  const animate = key !== lastQueryKey;
  lastQueryKey = key;

  let html;
  if (!state.from || !state.to) html = emptyHtml("select");
  else if (state.from === state.to) html = emptyHtml("same");
  else {
    const results = nextTrains(lineForDate(state.line), cal, state.from, state.to, n);
    if (!results.length) html = emptyHtml("none");
    else {
      const [first, ...rest] = results;
      const ld = getLine(first.period, state.line);
      const ids = ld.stations.map((s) => s.id);
      const oIdx = ids.indexOf(state.from);
      const dIdx = ids.indexOf(state.to);
      html = `<article class="next">
        <header class="next-head">
          <h2 class="section-label">${esc(t("next_train"))}</h2>
          <div class="badges">${badges(first)}</div>
        </header>
        <p class="countdown"><span class="cd-label">${esc(t("departs_in"))}</span><span class="cd-num">${countdownHtml(first.minutesUntil)}</span></p>
        <div class="times">
          <div class="time-block"><time class="num">${formatMinutes(first.depart)}</time><span>${esc(stationName(ld.stations[oIdx]))}</span></div>
          ${ARROW}
          <div class="time-block"><time class="num">${formatMinutes(first.arrive)}</time><span>${esc(stationName(ld.stations[dIdx]))}</span></div>
        </div>
        <dl class="meta">
          <div><dt>${esc(t("duration"))}</dt><dd class="num">${esc(durationText(first.durationMin))}</dd></div>
          <div><dt class="sr-only">${esc(t("train_no", { n: "" }))}</dt><dd class="train-no num">${esc(t("train_no", { n: first.train }))}</dd></div>
        </dl>
        ${routeHtml(first, ld.stations, oIdx, dIdx)}
      </article>`;
      if (rest.length) {
        html += `<h3 class="section-label later-title">${esc(t("later"))}</h3>
        <ul class="later">${rest
          .map(
            (r) => `<li>
              <span class="later-times num"><time>${formatMinutes(r.depart)}</time>${ARROW}<time>${formatMinutes(r.arrive)}</time></span>
              <span class="later-meta"><span class="num">${esc(t("train_no", { n: r.train }))}</span> · <span class="num">${esc(durationText(r.durationMin))}</span>${badges(r)}</span>
              <span class="later-in num">${esc(inText(r.minutesUntil))}</span>
            </li>`
          )
          .join("")}</ul>`;
      }
    }
  }
  setHtml(el.result, html);
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
  const prominent = renderAlerts(n);
  renderNotices(n, prominent);
  renderResult(n);
}

async function renderAll() {
  const n = now();
  await ensureDay(n.date, lineCodes).catch((err) => console.error(err));
  renderLines();
  renderSelects();
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

async function init() {
  const langReady = setLang(savedLang());
  try {
    const [timetables, holidays, overrides, alertData] = await Promise.all([
      fetchJson("data/timetables.json", true),
      optionalJson("data/holidays.json", {}),
      optionalJson("data/overrides.json", {}),
      optionalJson("data/alerts.json", null),
    ]);
    Object.assign(cal, { timetables, holidays: holidays || {}, overrides: overrides && typeof overrides === "object" ? overrides : {} });
    alerts = readAlerts(alertData);
    lineCodes = ALL_LINES.filter((c) => timetables.some((p) => p.lines.includes(c)));
    await langReady;
    await ensureDay(now().date, lineCodes);
  } catch (err) {
    console.error(err);
    await langReady.catch(() => {});
    el.result.innerHTML = `<p class="empty">${esc(t("load_error"))}</p>`;
    return;
  }
  loadState();
  bind();
  await renderAll();
  document.body.classList.add("ready");
}

init();

if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
