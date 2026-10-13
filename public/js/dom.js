// Safe DOM building: text always goes through text nodes, never through HTML parsing.
const SVG_NS = "http://www.w3.org/2000/svg";

function setProps(el, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "text") el.textContent = String(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function addChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    el.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  addChildren(el, children);
  return el;
}

// shapes: [["path", { d: "..." }], ["circle", { cx, cy, r }]]
export function svg(shapes, props = {}) {
  const root = document.createElementNS(SVG_NS, "svg");
  setProps(root, { viewBox: "0 0 24 24", "aria-hidden": "true", ...props });
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    setProps(shape, attrs);
    root.append(shape);
  }
  return root;
}

// Re-render only when the content key changes (keeps aria-live regions quiet on identical refreshes).
export function renderInto(node, key, build) {
  if (node.dataset.key === key) return false;
  node.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
  node.dataset.key = key;
  return true;
}
