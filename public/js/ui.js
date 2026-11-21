// Small DOM and formatting helpers shared by every screen.
//
// All markup is built with the `html` tagged template, which escapes every
// interpolated value unless it is already a SafeHtml produced by `html` itself
// or explicitly marked with `raw`. Model output and user text therefore cannot
// inject markup or script into the page.

export class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

/** Marks trusted, static markup (never user or model text). */
export function raw(value) {
  return new SafeHtml(String(value));
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function setHtml(element, markup) {
  element.innerHTML = render(markup);
}

export function uid(prefix = "id") {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function labelize(value) {
  return String(value ?? "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(iso, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, options);
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function money(range) {
  if (!range) return null;
  const format = (value) => `$${Number(value).toLocaleString("en-US")}`;
  return range.low === range.high ? format(range.low) : `${format(range.low)}–${format(range.high)}`;
}

export function hours(low, high) {
  const format = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return low === high ? `${format(low)} h` : `${format(low)}–${format(high)} h`;
}

export function addDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function isDue(iso, now = new Date()) {
  return Boolean(iso) && new Date(iso).getTime() <= now.getTime();
}

// ---------- toasts ----------
let toastTimer = null;
export function toast(message, { tone = "info", duration = 3200 } = {}) {
  const region = document.getElementById("toast");
  if (!region) return;
  region.textContent = message;
  region.dataset.tone = tone;
  region.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    region.hidden = true;
  }, duration);
}

// ---------- modal dialogs ----------
/**
 * Opens a modal with the given content. Resolves with the value passed to
 * close(), or null when dismissed. Focus moves into the dialog and returns.
 */
export function openModal(build, { label = "Dialog" } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", label);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    function close(value = null) {
      backdrop.remove();
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
      if (previous && typeof previous.focus === "function") previous.focus();
      resolve(value);
    }
    function onKey(event) {
      if (event.key === "Escape") close(null);
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });
    build(dialog, close);
    const focusable = dialog.querySelector("[autofocus], input, textarea, select, button");
    if (focusable) focusable.focus();
  });
}

export function confirmDialog(message, { confirmLabel = "Confirm", danger = false } = {}) {
  return openModal((dialog, close) => {
    setHtml(dialog, html`
      <p class="modal-message">${message}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="ok">${confirmLabel}</button>
      </div>`);
    dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    dialog.querySelector('[data-action="ok"]').addEventListener("click", () => close(true));
  }, { label: "Confirm" }).then((value) => value === true);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "report";
}
