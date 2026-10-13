import { h, svg } from "./dom.js";

export const SEVERITIES = ["info", "warning", "critical"];
const LINES = ["A", "D", "E"];
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const ICONS = {
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v5M12 7.5v.01" }]],
  warning: [
    ["path", { d: "M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" }],
    ["path", { d: "M12 9.5v4M12 17v.01" }],
  ],
  critical: [["path", { d: "M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2Z" }], ["path", { d: "M12 7.5v5.5M12 16.5v.01" }]],
  calendar: [["rect", { x: 3.5, y: 5, width: 17, height: 15, rx: 2.5 }], ["path", { d: "M3.5 10h17M8 3v4M16 3v4" }]],
  star: [["path", { d: "m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z" }]],
  download: [["path", { d: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" }]],
  share: [["path", { d: "M12 3.5v11M12 3.5 8.5 7M12 3.5 15.5 7" }], ["path", { d: "M8 10H6.5A1.5 1.5 0 0 0 5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" }]],
  addSquare: [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 3.5 }], ["path", { d: "M12 8.5v7M8.5 12h7" }]],
  close: [["path", { d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }]],
};

export const icon = (name) => svg(ICONS[name], { class: "icon" });

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

export function isValidAlert(a, scheduled = false) {
  const ok =
    a !== null &&
    typeof a === "object" &&
    SEVERITIES.includes(a.severity) &&
    nonEmpty(a.ar) &&
    nonEmpty(a.en) &&
    (a.lines === undefined || (Array.isArray(a.lines) && a.lines.length > 0 && a.lines.every((l) => l === "all" || LINES.includes(l))));
  if (!ok || !scheduled) return ok;
  return DATETIME.test(a.start) && DATETIME.test(a.end) && a.start < a.end;
}

// Keeps only the fields we use, so nothing else from the file ever reaches the page.
const clean = (a) => ({
  severity: a.severity,
  lines: a.lines ? [...a.lines] : ["all"],
  ar: a.ar.trim(),
  en: a.en.trim(),
  ...(a.start ? { start: a.start, end: a.end } : {}),
});

export function readAlerts(data, log = console) {
  const out = { message: null, scheduled: [] };
  if (!data || typeof data !== "object") return out;
  if (isValidAlert(data.message)) out.message = clean(data.message);
  else log.error("alerts.json: invalid 'message', showing the default text. Run scripts/validate_alerts.py for details.");
  (Array.isArray(data.scheduled) ? data.scheduled : []).forEach((a, i) => {
    if (isValidAlert(a, true)) out.scheduled.push(clean(a));
    else log.error(`alerts.json: scheduled alert #${i + 1} is invalid and was skipped.`);
  });
  return out;
}

export function activeAlerts(alerts, nowKey) {
  const list = alerts.message ? [alerts.message] : [];
  return [...list, ...alerts.scheduled.filter((a) => a.start <= nowKey && nowKey <= a.end)];
}

export const concerns = (a, line) => a.lines.includes("all") || a.lines.includes(line);

// a === null renders the default message from the locale files.
export function alertItem(a, { lang, t, formatDateTime }) {
  const severity = a?.severity || "info";
  const meta = [];
  if (a && !a.lines.includes("all")) meta.push(t("alert_lines", { lines: a.lines.join(" · ") }));
  if (a?.end) meta.push(t("alert_until", { when: formatDateTime(a.end) }));
  return h(
    "li",
    { class: `alert alert-${severity}` },
    icon(severity),
    h(
      "div",
      null,
      h("p", null, h("span", { class: "sr-only", text: `${t(`sev_${severity}`)}: ` }), a ? a[lang] : t("alert_default")),
      meta.length ? h("p", { class: "alert-meta num", text: meta.join(" — ") }) : null
    )
  );
}

export function callout(severity, text, t, iconName = severity) {
  return h(
    "div",
    { class: `callout callout-${severity}` },
    icon(iconName),
    h("p", null, h("span", { class: "sr-only", text: `${t(`sev_${severity}`)}: ` }), text)
  );
}
