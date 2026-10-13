export const LANGS = ["ar", "en"];
const STORE_KEY = "nextTrain.lang";

let lang = "ar";
let strings = {};
const cache = {};

export const getLang = () => lang;

export function savedLang() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return LANGS.includes(v) ? v : "ar";
  } catch {
    return "ar";
  }
}

export async function setLang(next) {
  if (!LANGS.includes(next)) next = "ar";
  if (!cache[next]) {
    const res = await fetch(`locales/${next}.json`);
    if (!res.ok) throw new Error(`locale ${next}: HTTP ${res.status}`);
    cache[next] = await res.json();
  }
  lang = next;
  strings = cache[next];
  document.documentElement.lang = next;
  document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {}
  translateDom();
}

export function t(key, vars = {}) {
  const s = strings[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

export function translateDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      el.setAttribute(attr, t(key));
    }
  }
  document.title = t("doc_title");
}

export function locale() {
  return lang === "ar" ? "ar-TN-u-nu-latn" : "en-GB";
}
