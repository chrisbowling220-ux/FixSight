// Settings: business branding, access, voice, data, and about.

import * as db from "../db.js";
import { $, confirmDialog, downloadBlob, html, raw, setHtml, toast } from "../ui.js";

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function resizeLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That logo file couldn't be read. Use a PNG or JPEG."));
      element.src = url;
    });
    const scale = Math.min(1, 400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function render(view, ctx) {
  const [business, accessCode, readAloud, dictationEngine, estimate, persisted] = await Promise.all([
    db.getSetting("business", {}),
    db.getSetting("accessCode", ""),
    db.getSetting("readAloudEngine", "device"),
    db.getSetting("dictationEngine", "device"),
    db.storageEstimate(),
    navigator.storage?.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false),
  ]);
  const caps = ctx.voice.caps;
  const health = ctx.health;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  setHtml(view, html`
    <h1 class="screen-title">Settings</h1>
    <div class="settings-grid">
      <section class="panel">
        <h2 class="panel-title">Business details for reports</h2>
        <p class="muted small">Shown at the top of PDF reports. Stored only on this device.</p>
        <form id="business-form" class="form">
          <label>Business name<input type="text" name="name" maxlength="120" value="${business.name ?? ""}" placeholder="Your company" /></label>
          <label>Phone<input type="tel" name="phone" maxlength="40" value="${business.phone ?? ""}" /></label>
          <label>Email<input type="email" name="email" maxlength="120" value="${business.email ?? ""}" /></label>
          <label>Website<input type="text" name="website" maxlength="120" value="${business.website ?? ""}" /></label>
          <label>License number<input type="text" name="license" maxlength="60" value="${business.license ?? ""}" /></label>
          <div class="logo-row">
            ${business.logoDataUrl ? html`<img src="${business.logoDataUrl}" alt="Business logo" class="logo-preview" />` : ""}
            <label class="btn btn-secondary btn-small photo-pick"><input type="file" id="logo-file" accept="image/png,image/jpeg" hidden />${business.logoDataUrl ? "Change logo" : "Add logo"}</label>
            ${business.logoDataUrl ? html`<button type="button" class="btn btn-ghost btn-small" id="remove-logo">Remove logo</button>` : ""}
          </div>
          <button type="submit" class="btn btn-accent">Save business details</button>
        </form>
      </section>

      <section class="panel">
        <h2 class="panel-title">Server &amp; access</h2>
        <dl class="kv">
          <div><dt>Connection</dt><dd>${{ online: "Connected", offline: "Offline", unreachable: "Server unreachable", checking: "Checking" }[ctx.connection]}</dd></div>
          ${health ? html`<div><dt>AI analysis</dt><dd>${health.demo_mode ? "Demo mode (sample results)" : health.analysis_configured ? "Available" : "Not configured on this server"}</dd></div>
          <div><dt>Prompt version</dt><dd>${health.prompt_version}</dd></div>` : ""}
        </dl>
        ${health?.access_code_required || accessCode ? html`<form id="access-form" class="form">
          <label>Access code<input type="password" name="code" value="${accessCode}" autocomplete="off" placeholder="Provided by your FixSight administrator" /></label>
          <p class="muted small">This server asks for a shared code before running paid analyses.</p>
          <button type="submit" class="btn btn-secondary">Save access code</button></form>` : html`<p class="muted small">This server doesn't require an access code.</p>`}
      </section>

      <section class="panel">
        <h2 class="panel-title">Voice</h2>
        ${!caps.secure ? html`<p class="alert alert-warn small">Voice input needs a secure (https) connection. It's unavailable on this address.</p>` : ""}
        <fieldset class="radio-group"><legend>Read results aloud with</legend>
          <label class="check"><input type="radio" name="readAloud" value="device" ${readAloud !== "premium" ? raw("checked") : ""} ${caps.deviceSpeech ? "" : raw("disabled")} /> <span>This device's voice (free, works offline)</span></label>
          <label class="check"><input type="radio" name="readAloud" value="premium" ${readAloud === "premium" ? raw("checked") : ""} ${caps.premiumSpeech ? "" : raw("disabled")} /> <span>Premium voice ${caps.premiumSpeech ? "(uses the server's ElevenLabs credits)" : "(not configured on this server)"}</span></label>
        </fieldset>
        <fieldset class="radio-group"><legend>Dictation (microphone) with</legend>
          <label class="check"><input type="radio" name="dictation" value="device" ${dictationEngine !== "premium" ? raw("checked") : ""} ${caps.deviceRecognition ? "" : raw("disabled")} /> <span>Browser speech recognition (free${caps.deviceRecognition ? "" : "; not supported here"})</span></label>
          <label class="check"><input type="radio" name="dictation" value="premium" ${dictationEngine === "premium" ? raw("checked") : ""} ${caps.premiumDictation ? "" : raw("disabled")} /> <span>Premium transcription ${caps.premiumDictation ? "(uses ElevenLabs credits)" : "(not available)"}</span></label>
        </fieldset>
        <p class="muted small">Browser speech recognition may send audio to your browser maker's service (for example Google in Chrome, Apple in Safari). The microphone is used only while the mic button is active.</p>
      </section>

      <section class="panel">
        <h2 class="panel-title">Your data</h2>
        <p class="small">Inspections, photos, customers, and jobs are stored <strong>only on this device</strong>. They are not synced or backed up automatically. Export a backup file regularly and keep it somewhere safe.</p>
        <dl class="kv">
          <div><dt>Storage used</dt><dd>${estimate ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}` : "unknown"}</dd></div>
          <div><dt>Protected from automatic cleanup</dt><dd>${persisted ? "Yes" : "Not guaranteed"}</dd></div>
        </dl>
        <div class="btn-row wrap">
          <button type="button" class="btn btn-primary" id="export">Export backup</button>
          <label class="btn btn-secondary photo-pick"><input type="file" id="import" accept="application/json,.json" hidden />Import backup</label>
          <button type="button" class="btn btn-danger-ghost" id="clear">Delete all data</button>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">Install on your phone or tablet</h2>
        ${standalone ? html`<p class="small">FixSight is installed on this device.</p>` : html`
          ${installPrompt ? html`<button type="button" class="btn btn-accent" id="install">Install FixSight</button>` : ""}
          <ul class="small">
            <li><strong>iPhone / iPad (Safari):</strong> tap Share, then "Add to Home Screen".</li>
            <li><strong>Android (Chrome):</strong> open the ⋮ menu, then "Install app" or "Add to Home screen".</li>
            <li><strong>Computer (Chrome/Edge):</strong> click the install icon in the address bar.</li>
          </ul>
          <p class="muted small">Installing and offline use need the secure (https) address of your FixSight server.</p>`}
      </section>

      <section class="panel">
        <h2 class="panel-title">What FixSight can and can't do</h2>
        <ul class="small">
          <li>It gives a cautious first look at <strong>visible</strong> problems from photos. It is not a professional inspection, appraisal, or quote.</li>
          <li>It can't see inside walls, measure moisture or temperature, detect gas, or confirm structural safety from a photo.</li>
          <li>Cost and labor figures are rough US planning ranges with stated assumptions.</li>
          <li>For anything electrical, gas, structural, or involving possible asbestos or lead, use a licensed professional.</li>
          <li>Photos you analyze are sent to the FixSight server and its AI provider (Anthropic) to produce the assessment. Reports are created on your device.</li>
        </ul>
      </section>
    </div>`);

  $("#business-form", view).addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(event.target).entries()].map(([key, value]) => [key, String(value).trim()]));
    await db.setSetting("business", { ...business, ...values });
    toast("Business details saved.");
  });
  $("#logo-file", view).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await db.setSetting("business", { ...business, logoDataUrl: await resizeLogo(file) });
      toast("Logo saved.");
      ctx.rerender();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  });
  $("#remove-logo", view)?.addEventListener("click", async () => {
    const { logoDataUrl: _removed, ...rest } = business;
    await db.setSetting("business", rest);
    ctx.rerender();
  });
  $("#access-form", view)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await db.setSetting("accessCode", String(new FormData(event.target).get("code") ?? "").trim());
    toast("Access code saved.");
  });
  view.addEventListener("change", async (event) => {
    if (event.target.name === "readAloud") await db.setSetting("readAloudEngine", event.target.value);
    if (event.target.name === "dictation") await db.setSetting("dictationEngine", event.target.value);
  });
  $("#export", view).addEventListener("click", async () => {
    const data = await db.exportAll();
    downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `fixsight-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast("Backup downloaded. Keep it somewhere safe; it contains your photos and customer details.");
  });
  $("#import", view).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const count = await db.importAll(JSON.parse(await file.text()));
      toast(`Imported ${count} record${count === 1 ? "" : "s"}.`);
      ctx.rerender();
    } catch (error) {
      toast(error.message || "That backup couldn't be imported.", { tone: "error" });
    }
  });
  $("#clear", view).addEventListener("click", async () => {
    if (!(await confirmDialog("Delete every inspection, photo, customer, job, and setting on this device? Export a backup first if you might need them.", { confirmLabel: "Delete everything", danger: true }))) return;
    await db.clearAll();
    await db.setSetting("legacyHistoryMigrated", true);
    toast("All FixSight data on this device was deleted.");
    ctx.navigate("/scan");
  });
  $("#install", view)?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    ctx.rerender();
  });
}
