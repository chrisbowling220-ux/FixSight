// FixSight web app: bootstrap, routing, connection status, and shared context.

import * as api from "./api.js";
import * as db from "./db.js";
import { $, $$, toast, uid } from "./ui.js";
import { Reader, capabilities } from "./voice.js";
import * as scanScreen from "./screens/scan.js";
import * as inspectionScreen from "./screens/inspection.js";
import * as listScreen from "./screens/inspections.js";
import * as jobsScreen from "./screens/jobs.js";
import * as settingsScreen from "./screens/settings.js";

const ctx = {
  health: null,
  voice: { premiumAvailable: false, caps: capabilities(false) },
  connection: "checking",
  reader: null,
  navigate(path) {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  },
  rerender: () => route(),
  isOnline() {
    return ctx.connection === "online";
  },
};

ctx.reader = new Reader((state) => {
  document.dispatchEvent(new CustomEvent("reader-state", { detail: state }));
});

// ---------- connection status ----------

const CONNECTION_LABELS = {
  checking: "Checking…",
  online: "Online",
  offline: "Offline — saved work available",
  unreachable: "Server unreachable",
};

function setConnection(state) {
  const changed = ctx.connection !== state;
  ctx.connection = state;
  const pill = $("#connection");
  pill.dataset.state = state;
  pill.textContent = CONNECTION_LABELS[state];
  pill.title = state === "online"
    ? "Connected to the FixSight server."
    : "New analyses need a connection. Saved inspections, jobs, and reports still work.";
  if (changed) document.dispatchEvent(new CustomEvent("connection-change", { detail: state }));
}

async function checkHealth() {
  if (navigator.onLine === false) {
    setConnection("offline");
    return;
  }
  try {
    ctx.health = await api.health();
    $("#banner-demo").hidden = !ctx.health.demo_mode;
    setConnection("online");
  } catch {
    setConnection(navigator.onLine === false ? "offline" : "unreachable");
  }
}

async function checkVoice() {
  try {
    const status = await api.voiceStatus();
    ctx.voice.premiumAvailable = Boolean(status?.available);
  } catch {
    ctx.voice.premiumAvailable = false;
  }
  ctx.voice.caps = capabilities(ctx.voice.premiumAvailable);
}

$("#connection").addEventListener("click", () => {
  checkHealth().then(() => toast(CONNECTION_LABELS[ctx.connection]));
});
window.addEventListener("online", checkHealth);
window.addEventListener("offline", () => setConnection("offline"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkHealth();
});
setInterval(() => {
  if (document.visibilityState === "visible") checkHealth();
}, 30_000);

// ---------- routing ----------

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/scan";
  const [path, query = ""] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, query: new URLSearchParams(query) };
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  const { parts, query } = parseHash();
  const container = $("#view");
  const [section, id, sub] = parts;
  // Each render gets a fresh element, so listeners from the previous screen
  // are discarded with it instead of accumulating on a shared container.
  const view = document.createElement("div");
  view.className = "screen";
  container.replaceChildren(view);
  ctx.reader.stop();

  const navKey = { inspection: "inspections", compare: "inspections", job: "jobs", customer: "jobs" }[section] ?? section ?? "scan";
  $$(".nav a").forEach((link) => {
    const active = link.dataset.nav === navKey;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });


  try {
    if (section === "inspection" && id && sub === "questions") await inspectionScreen.renderQuestions(view, id, ctx);
    else if (section === "inspection" && id) await inspectionScreen.renderDetail(view, id, ctx);
    else if (section === "compare" && id) await inspectionScreen.renderCompare(view, id, ctx);
    else if (section === "inspections") await listScreen.render(view, query, ctx);
    else if (section === "jobs") await jobsScreen.renderList(view, query, ctx);
    else if (section === "job" && id) await jobsScreen.renderJob(view, id, query, ctx);
    else if (section === "customer" && id) await jobsScreen.renderCustomer(view, id, ctx);
    else if (section === "settings") await settingsScreen.render(view, ctx);
    else await scanScreen.render(view, query, ctx);
  } catch (error) {
    if (token !== routeToken) return;
    console.error(error);
    const card = document.createElement("div");
    card.className = "alert alert-danger";
    card.textContent = error?.message || "Something went wrong showing this screen.";
    view.replaceChildren(card);
  }
  if (token !== routeToken) return;
  requestAnimationFrame(() => view.classList.add("view-enter"));
  if (document.activeElement === document.body) container.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

// ---------- one-time migration of the old browser history ----------

async function migrateLegacyHistory() {
  if (await db.getSetting("legacyHistoryMigrated", false)) return 0;
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem("fixsight_history") || "[]");
  } catch {
    items = [];
  }
  let count = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.result) continue;
    const thumb = typeof item.thumb === "string" ? item.thumb : null;
    await db.put("inspections", {
      id: uid("insp"),
      createdAt: item.date || new Date().toISOString(),
      status: item.result.result_type === "diagnosis" ? "complete" : item.result.result_type || "complete",
      photos: thumb ? [{ id: uid("photo"), dataUrl: thumb, thumb, role: null, annotated: false, marks: [], quality: null }] : [],
      category: item.category || "",
      description: "",
      readings: [],
      answers: [],
      analysis: item.result,
      jobId: null,
      parentId: null,
      notes: [],
      progressPhotos: [],
      checklist: {},
      resolved: false,
      legacy: true,
    });
    count += 1;
  }
  // The old localStorage entry is left in place as a fallback copy.
  await db.setSetting("legacyHistoryMigrated", true);
  return count;
}

// ---------- service worker ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !globalThis.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").then((registration) => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          $("#banner-update").hidden = false;
        }
      });
    });
  }).catch(() => {
    /* offline support is a bonus; the app works without it */
  });
  $("#reload-app").addEventListener("click", () => location.reload());
}

// ---------- start ----------

(async function start() {
  registerServiceWorker();
  try {
    await db.openDb();
    const migrated = await migrateLegacyHistory();
    if (migrated) toast(`Moved ${migrated} earlier scan${migrated === 1 ? "" : "s"} into History.`);
    db.requestPersistence();
  } catch (error) {
    toast(error.message || "Offline storage is unavailable in this browser.", { tone: "error", duration: 6000 });
  }
  await Promise.all([checkHealth(), checkVoice()]);
  route();
})();
