const CACHE_VERSION = "next-train-v3";

const APP_SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/alerts.js",
  "js/calendar.js",
  "js/dom.js",
  "js/i18n.js",
  "js/install.js",
  "js/search.js",
  "locales/ar.json",
  "locales/en.json",
  "data/timetables.json",
  "data/holidays.json",
  "data/overrides.json",
  "data/alerts.json",
  "assets/fonts/cairo-arabic.woff2",
  "assets/fonts/cairo-latin.woff2",
  "assets/fonts/cairo-latin-ext.woff2",
  "assets/img/hero-train-800.webp",
  "assets/img/tunis-station-640.webp",
  "assets/icons/favicon.png",
  "assets/icons/icon-192.png",
];

// Files the owner edits by hand: always try the network first so changes show on the next reload.
const NETWORK_FIRST = /\/data\/(alerts|overrides|timetables|holidays)\.json$/;
// Generated timetables: answer from cache, refresh in the background.
const TIMETABLE = /\/data\/[^/]+\/line_[A-Z]\.json$/;
// Kill switch: never cached, never answered by the worker.
const KILL_FILE = /\/data\/sw-kill\.json$/;

let lastKillCheck = 0;

// If data/sw-kill.json says {"kill": true}: delete every cache, unregister, and reload open pages from the network.
async function checkKillSwitch() {
  if (Date.now() - lastKillCheck < 30_000) return;
  lastKillCheck = Date.now();
  try {
    const res = await fetch("data/sw-kill.json", { cache: "no-store" });
    if (!res.ok || (await res.json())?.kill !== true) return;
  } catch {
    return;
  }
  await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(checkKillSwitch)
  );
});

function store(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
  }
  return response;
}

const networkFirst = (request) =>
  fetch(request, { cache: "no-cache" })
    .then((res) => store(request, res))
    .catch(() => caches.match(request, { ignoreSearch: true }));

function staleWhileRevalidate(event) {
  const network = fetch(event.request).then((res) => store(event.request, res));
  event.waitUntil(network.catch(() => {}));
  return caches.match(event.request).then((hit) => hit || network);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Cross-origin requests (e.g. Cloudflare Web Analytics) are never intercepted or cached.
  if (request.method !== "GET" || url.origin !== location.origin || KILL_FILE.test(url.pathname)) return;

  if (request.mode === "navigate") {
    event.waitUntil(checkKillSwitch());
    event.respondWith(networkFirst(request));
  } else if (NETWORK_FIRST.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  } else if (TIMETABLE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  } else {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => store(request, res))));
  }
});
