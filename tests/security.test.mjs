import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* A tiny DOM stand-in. innerHTML/outerHTML/insertAdjacentHTML throw, so any HTML parsing fails the test. */
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...nodes) {
    for (const n of nodes) {
      if (!(n instanceof FakeNode)) throw new Error(`append() got a non-node: ${n}`);
      this.childNodes.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.childNodes = [new FakeText(String(v))];
  }
}
class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toLowerCase();
    this.attributes = new Map();
    this.dataset = {};
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.get(k) ?? null;
  }
  descendants() {
    return this.childNodes.flatMap((c) => (c instanceof FakeElement ? [c, ...c.descendants()] : []));
  }
}
for (const sink of ["innerHTML", "outerHTML"]) {
  Object.defineProperty(FakeElement.prototype, sink, {
    get() {
      throw new Error(`${sink} read`);
    },
    set() {
      throw new Error(`${sink} used`);
    },
  });
}
FakeElement.prototype.insertAdjacentHTML = () => {
  throw new Error("insertAdjacentHTML used");
};
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (data) => new FakeText(data),
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function serialize(node) {
  if (node instanceof FakeText) return esc(node.data);
  const attrs = [...node.attributes].map(([k, v]) => ` ${k}="${esc(v).replace(/"/g, "&quot;")}"`).join("");
  return `<${node.tagName}${attrs}>${node.childNodes.map(serialize).join("")}</${node.tagName}>`;
}

const { h } = await import("../public/js/dom.js");
const { alertItem, callout, readAlerts } = await import("../public/js/alerts.js");

const PAYLOAD = "<img src=x onerror=alert(1)>";
const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? JSON.stringify(vars) : ""}`;
const ctx = (lang) => ({ lang, t, formatDateTime: (s) => s });
const silent = { error() {} };

test("an alert containing HTML renders as plain text", () => {
  const alerts = readAlerts({ message: { severity: "critical", lines: ["A"], ar: PAYLOAD, en: PAYLOAD }, scheduled: [] }, silent);
  for (const lang of ["ar", "en"]) {
    const li = alertItem(alerts.message, ctx(lang));
    assert.ok(li.textContent.includes(PAYLOAD), "the text is shown as written");
    assert.ok(!li.descendants().some((e) => e.tagName === "img"), "no <img> element is created");
    assert.ok(!li.descendants().some((e) => [...e.attributes.keys()].some((k) => k.startsWith("on"))), "no event-handler attributes");
    assert.ok(serialize(li).includes(esc(PAYLOAD)), "the markup is escaped");
  }
});

test("callouts and the critical banner text are plain text too", () => {
  const node = callout("critical", PAYLOAD, t);
  assert.ok(node.textContent.includes(PAYLOAD));
  assert.ok(!node.descendants().some((e) => e.tagName === "img"));
  const banner = h("p", { text: PAYLOAD });
  assert.equal(banner.childNodes.length, 1);
  assert.ok(banner.childNodes[0] instanceof FakeText);
});

test("station or line names from JSON cannot inject markup", () => {
  const option = h("option", { value: '"><img src=x onerror=alert(1)>', text: PAYLOAD });
  assert.equal(option.descendants().length, 0);
  assert.equal(option.textContent, PAYLOAD);
});

test("readAlerts keeps only known fields and drops invalid alerts", () => {
  const data = {
    message: { severity: "info", lines: ["all"], ar: "أ", en: "a", html: PAYLOAD, onclick: "alert(1)" },
    scheduled: [
      { severity: "warning", lines: ["D"], start: "2026-11-02T22:00", end: "2026-11-03T05:00", ar: "ب", en: "b", style: "x" },
      { severity: "nope", lines: ["D"], start: "2026-11-02T22:00", end: "2026-11-03T05:00", ar: "ب", en: "b" },
      { severity: "info", lines: ["Z"], start: "2026-11-02T22:00", end: "2026-11-03T05:00", ar: "ب", en: "b" },
    ],
  };
  const out = readAlerts(data, silent);
  assert.deepEqual(Object.keys(out.message).sort(), ["ar", "en", "lines", "severity"]);
  assert.equal(out.scheduled.length, 1);
  assert.deepEqual(Object.keys(out.scheduled[0]).sort(), ["ar", "en", "end", "lines", "severity", "start"]);
  assert.equal(readAlerts({ message: { severity: "info", ar: "", en: "x" } }, silent).message, null);
});

/* Static checks on the source files. */
const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const read = (p) => readFileSync(pub(p), "utf8");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'";

test("no HTML-parsing sinks or dynamic code in any script", () => {
  const files = [...readdirSync(pub("js")).map((f) => `js/${f}`), "sw.js"];
  for (const f of files) {
    const src = read(f);
    for (const bad of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/, /setAttribute\(\s*["']style/, /\.style\./]) {
      assert.ok(!bad.test(src), `${f} must not use ${bad}`);
    }
  }
});

test("index.html has a strict CSP and nothing inline", () => {
  const html = read("index.html");
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(meta, "CSP meta tag present");
  assert.ok(meta[1].startsWith(CSP));
  assert.ok(meta[1].includes("base-uri 'self'") && meta[1].includes("form-action 'none'"));
  assert.ok(!meta[1].includes("frame-ancestors"), "frame-ancestors is ignored in <meta>, keep it in _headers");
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<link"), "CSP comes before any resource");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "no inline <script>");
  assert.ok(!/<style/i.test(html), "no <style> block");
  assert.ok(!/\sstyle\s*=/.test(html), "no style= attribute");
  assert.ok(!/\son[a-z]+\s*=/.test(html), "no inline event handler");
});

test("_headers sets the security headers and no-cache rules", () => {
  const headers = read("_headers");
  assert.ok(headers.includes(`Content-Security-Policy: ${CSP}; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`));
  for (const line of [
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()",
    "X-Frame-Options: DENY",
  ]) {
    assert.ok(headers.includes(line), line);
  }
  for (const path of ["/data/alerts.json", "/data/overrides.json", "/data/timetables.json", "/sw.js"]) {
    assert.match(headers, new RegExp(`^${path.replace(/[./]/g, "\\$&")}\\r?\\n\\s+Cache-Control: no-cache`, "m"), path);
  }
});

test("manifest is installable", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.match(m.name, /[؀-ۿ]/);
  assert.match(m.short_name, /[؀-ۿ]/);
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  assert.ok(m.theme_color && m.background_color);
  const has = (size, purpose) => m.icons.some((i) => i.sizes === size && (i.purpose || "any").split(" ").includes(purpose));
  assert.ok(has("192x192", "any") && has("512x512", "any") && has("512x512", "maskable"));
});

test("service worker has the kill switch and never caches sw-kill.json", () => {
  const sw = read("sw.js");
  assert.match(sw, /sw-kill\.json/);
  assert.match(sw, /registration\.unregister\(\)/);
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /KILL_FILE\.test\(url\.pathname\)\) return;/);
  assert.deepEqual(JSON.parse(read("data/sw-kill.json")), { kill: false });
});
