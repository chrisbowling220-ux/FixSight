// The Inspect screen: photos, context, measurements, and starting an analysis.

import * as db from "../db.js";
import { annotatePhoto, MAX_PHOTOS, photoFromFile, QUALITY_MESSAGES, ROLE_LABELS } from "../photos.js";
import { $, $$, html, isDue, raw, setHtml, toast, uid, formatDate, confirmDialog } from "../ui.js";
import { inspectionTitle } from "../analysis-view.js";
import { startDictation } from "../voice.js";
import { runAnalysis } from "./inspection.js";

const CATEGORIES = [
  "Ceiling / Roof", "Wall / Drywall", "Floor", "Window / Door", "Plumbing",
  "Electrical", "HVAC", "Appliance", "Exterior", "Other",
];

const READING_KINDS = {
  dimension: "Measurement (size)",
  moisture: "Moisture meter reading",
  temperature: "Temperature",
  humidity: "Humidity",
};

function emptyDraft() {
  return {
    id: null,
    photos: [],
    category: "",
    description: "",
    readings: [],
    jobId: null,
    parentId: null,
    mode: "new",
  };
}

// Survives navigation within the app so a stray tap never loses photos.
let draft = emptyDraft();
let dictation = null;

/** Saves unsaved photos as a draft before another flow replaces them. */
async function parkCurrentDraft() {
  if (draft.photos.length === 0) return;
  try {
    await persistDraft("draft");
    toast("Your unsaved photos were kept as a draft.");
  } catch {
    /* best effort; the new flow still opens */
  }
}

async function loadMode(query) {
  const retakeId = query.get("retake");
  const addId = query.get("add");
  const parentId = query.get("parent");
  const jobId = query.get("job");
  const sourceId = retakeId || addId;
  if (sourceId && draft.id !== sourceId) {
    const source = await db.get("inspections", sourceId);
    if (source) {
      await parkCurrentDraft();
      draft = {
        id: source.id,
        photos: retakeId ? [] : structuredClone(source.photos ?? []),
        category: source.category ?? "",
        description: source.description ?? "",
        readings: structuredClone(source.readings ?? []),
        jobId: source.jobId ?? null,
        parentId: source.parentId ?? null,
        mode: retakeId ? "retake" : "add",
      };
    }
  } else if (parentId && draft.parentId !== parentId) {
    const parent = await db.get("inspections", parentId);
    if (parent) {
      await parkCurrentDraft();
      draft = {
        ...emptyDraft(),
        category: parent.category ?? "",
        description: `Follow-up check of: ${inspectionTitle(parent)}`,
        jobId: parent.jobId ?? null,
        parentId: parent.id,
        mode: "followup",
      };
    }
  }
  if (jobId && !draft.jobId) draft.jobId = jobId;
}

export async function render(view, query, ctx) {
  await loadMode(query);
  const [inspections, jobs, customers] = await Promise.all([db.listInspections(), db.listJobs(), db.listCustomers()]);
  const customerName = Object.fromEntries(customers.map((customer) => [customer.id, customer.name]));
  const parent = draft.parentId ? inspections.find((item) => item.id === draft.parentId) : null;
  const due = inspections.filter((item) => !item.resolved && item.followUpDue && isDue(item.followUpDue));
  const drafts = inspections.filter((item) => item.status === "draft" && item.id !== draft.id);
  const online = ctx.isOnline();

  const modeBanner = {
    retake: "Retaking photos for an earlier inspection. Add new photos, then analyze again.",
    add: "Add the photos FixSight asked for, then re-check.",
    followup: "Follow-up check: try to match the angle of the earlier photo so the comparison is fair.",
  }[draft.mode];

  setHtml(view, html`
    <h1 class="screen-title">New inspection</h1>
    ${due.length ? html`<section class="alert alert-info"><h2 class="alert-title">Due for a follow-up check</h2>
      <ul class="link-list">${due.slice(0, 4).map((item) => html`<li><a href="#/inspection/${item.id}">${inspectionTitle(item)}</a> <span class="muted small">due ${formatDate(item.followUpDue)}</span></li>`)}</ul></section>` : ""}
    ${drafts.length ? html`<section class="alert alert-quiet"><h2 class="alert-title">Drafts waiting for analysis</h2>
      <ul class="link-list">${drafts.slice(0, 4).map((item) => html`<li><a href="#/inspection/${item.id}">${inspectionTitle(item)}</a> <span class="muted small">${formatDate(item.createdAt)}</span></li>`)}</ul></section>` : ""}
    ${modeBanner ? html`<div class="note-card">${modeBanner}</div>` : ""}

    <div class="scan-grid">
      <section class="panel">
        <h2 class="panel-title">1. Photos <span class="muted small">(up to ${MAX_PHOTOS})</span></h2>
        <details class="tips" ${draft.photos.length ? "" : raw("open")}>
          <summary>How to take photos FixSight can use</summary>
          <ol class="small">
            <li><strong>One wide shot</strong> showing the whole area and what's around it.</li>
            <li><strong>One close-up</strong> of the problem, sharp and in focus.</li>
            <li>Use daylight or room lights; avoid flash glare. Hold steady.</li>
            <li>Put a ruler or coin next to cracks or gaps if you can, or measure and add it below.</li>
          </ol>
        </details>
        ${parent?.photos?.[0] ? html`<figure class="framing-guide"><img src="${parent.photos[0].thumb || parent.photos[0].dataUrl}" alt="Earlier photo for framing" /><figcaption class="small muted">Earlier photo (${formatDate(parent.createdAt)}) — match this angle.</figcaption></figure>` : ""}
        <div id="photo-list" class="photo-list"></div>
        <div class="photo-buttons">
          <label class="btn btn-primary photo-pick" id="take-label">
            <input type="file" id="take-photo" accept="image/*" capture="environment" hidden />
            <span aria-hidden="true">📷</span> Take photo
          </label>
          <label class="btn btn-secondary photo-pick">
            <input type="file" id="choose-photos" accept="image/*" multiple hidden />
            <span aria-hidden="true">🖼️</span> From library
          </label>
        </div>
        <p class="muted small drop-hint">On a computer you can also drag photos onto this page.</p>
        <p class="muted small">Photos show visible surfaces only. FixSight can't measure moisture or temperature or see inside walls from a photo.</p>
      </section>

      <section class="panel">
        <h2 class="panel-title">2. What is it? <span class="muted small">(optional)</span></h2>
        <div class="chips" id="category-chips" role="group" aria-label="Category">
          ${CATEGORIES.map((category) => html`<button type="button" class="chip ${draft.category === category ? "selected" : ""}" data-cat="${category}" aria-pressed="${draft.category === category}">${category}</button>`)}
        </div>

        <label class="field-label" for="description">3. What have you noticed? <span class="muted small">(optional)</span></label>
        <div class="input-with-mic">
          <textarea id="description" rows="3" maxlength="2000" placeholder="When it started, whether it changes with rain, any smells or sounds…">${draft.description}</textarea>
          <button type="button" id="mic-btn" class="mic-btn" hidden aria-label="Dictate a description">🎤</button>
        </div>
        <p id="mic-status" class="mic-status small" hidden></p>

        <details class="measurements" ${draft.readings.length ? raw("open") : ""}>
          <summary>4. Add measurements <span class="muted small">(optional, <span id="reading-count">${draft.readings.length}</span>)</span></summary>
          <p class="muted small">FixSight never guesses sizes from a photo. Add any you measured.</p>
          <ul id="reading-list" class="reading-list"></ul>
          <div class="reading-form" id="reading-form">
            <label class="field-label small" for="reading-kind">Type</label>
            <select id="reading-kind">${Object.entries(READING_KINDS).map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
            <div id="reading-fields"></div>
            <button type="button" class="btn btn-secondary btn-small" id="add-reading">Add measurement</button>
          </div>
        </details>

        <label class="field-label" for="job-select">5. Link to a job <span class="muted small">(optional)</span></label>
        <select id="job-select">
          <option value="">No job</option>
          ${jobs.map((job) => html`<option value="${job.id}" ${draft.jobId === job.id ? raw("selected") : ""}>${job.title}${job.customerId && customerName[job.customerId] ? ` — ${customerName[job.customerId]}` : ""}</option>`)}
        </select>
      </section>
    </div>

    <div class="sticky-actions">
      <button type="button" id="analyze-btn" class="btn btn-accent btn-big" ${draft.photos.length ? "" : raw("disabled")}>
        ${online ? "Analyze photos" : "Save draft — analyze when online"}
      </button>
      <div class="btn-row">
        <button type="button" id="save-draft" class="btn btn-secondary" ${draft.photos.length ? "" : raw("disabled")}>Save as draft</button>
        <button type="button" id="discard" class="btn btn-ghost" ${draft.photos.length || draft.description ? "" : raw("disabled")}>Start over</button>
      </div>
      ${online ? "" : html`<p class="muted small center">You're offline or the server can't be reached. Drafts are kept on this device.</p>`}
    </div>`);

  renderPhotos(view);
  renderReadings(view);
  renderReadingFields(view);
  wire(view, ctx);
}

function renderPhotos(view) {
  const list = $("#photo-list", view);
  if (!draft.photos.length) {
    setHtml(list, html`<div class="photo-empty">No photos yet</div>`);
    return;
  }
  setHtml(list, draft.photos.map((photo, index) => html`
    <article class="photo-tile" data-index="${index}">
      <img src="${photo.thumb}" alt="Photo ${index + 1}${photo.annotated ? ", marked" : ""}" />
      <div class="photo-meta">
        <div class="chips chips-small" role="group" aria-label="Photo ${index + 1} framing">
          ${Object.entries(ROLE_LABELS).map(([role, label]) => html`<button type="button" class="chip ${photo.role === role ? "selected" : ""}" data-role="${role}" aria-pressed="${photo.role === role}">${label}</button>`)}
        </div>
        ${(photo.quality?.warnings ?? []).map((warning) => html`<p class="quality-warn small">⚠ ${QUALITY_MESSAGES[warning]}</p>`)}
        <div class="btn-row">
          <button type="button" class="btn btn-secondary btn-small" data-action="annotate">${photo.annotated ? "Edit marks" : "Mark problem"}</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="remove" aria-label="Remove photo ${index + 1}">Remove</button>
        </div>
      </div>
    </article>`));
}

function readingSummary(reading) {
  if (reading.kind === "dimension") return `${reading.what}: ${reading.value} ${reading.unit} at ${reading.location}`;
  if (reading.kind === "moisture") {
    const value = reading.scale === "qualitative" ? reading.qualitative : `${reading.value}${reading.scale === "relative_0_100" ? " (relative)" : "%"}`;
    const reference = reading.reference_value !== undefined ? `, dry reference ${reading.reference_value}` : ", no dry reference";
    return `Moisture ${value} at ${reading.location}${reference}`;
  }
  if (reading.kind === "temperature") return `Temperature ${reading.value}°${reading.unit.toUpperCase()} at ${reading.location}`;
  return `Humidity ${reading.relative_humidity}%${reading.air_temperature !== undefined ? ` at ${reading.air_temperature}°${(reading.unit ?? "f").toUpperCase()}` : ""} at ${reading.location}`;
}

function renderReadings(view) {
  const list = $("#reading-list", view);
  const count = $("#reading-count", view);
  if (count) count.textContent = String(draft.readings.length);
  setHtml(list, draft.readings.map((reading, index) => html`
    <li>${readingSummary(reading)} <button type="button" class="link-btn" data-remove-reading="${index}">Remove</button></li>`));
}

function renderReadingFields(view) {
  const kind = $("#reading-kind", view).value;
  const location = html`<label class="small">Where <input type="text" id="r-location" maxlength="200" placeholder="e.g. above the door frame" /></label>`;
  const fields = {
    dimension: html`
      <label class="small">What <input type="text" id="r-what" maxlength="120" placeholder="e.g. crack width" /></label>
      <div class="inline-fields"><label class="small">Value <input type="number" id="r-value" min="0" step="any" inputmode="decimal" /></label>
      <label class="small">Unit <select id="r-unit"><option>mm</option><option>cm</option><option>m</option><option>in</option><option>ft</option></select></label></div>
      ${location}`,
    moisture: html`
      <div class="inline-fields"><label class="small">Reading <input type="number" id="r-value" min="0" max="100" step="any" inputmode="decimal" /></label>
      <label class="small">Scale <select id="r-scale"><option value="percent_wme">% WME (pin meter)</option><option value="percent_moisture_content">% moisture content</option><option value="relative_0_100">Relative 0–100 (pinless)</option></select></label></div>
      ${location}
      <label class="small">Dry reference reading, same material (recommended) <input type="number" id="r-ref" min="0" max="100" step="any" inputmode="decimal" /></label>`,
    temperature: html`
      <div class="inline-fields"><label class="small">Value <input type="number" id="r-value" step="any" inputmode="decimal" /></label>
      <label class="small">Unit <select id="r-unit"><option value="f">°F</option><option value="c">°C</option></select></label></div>
      ${location}`,
    humidity: html`
      <div class="inline-fields"><label class="small">Relative humidity % <input type="number" id="r-rh" min="0" max="100" step="any" inputmode="decimal" /></label>
      <label class="small">Air temp <input type="number" id="r-air" step="any" inputmode="decimal" /></label>
      <label class="small">Unit <select id="r-unit"><option value="f">°F</option><option value="c">°C</option></select></label></div>
      ${location}`,
  };
  setHtml($("#reading-fields", view), fields[kind]);
}

function readReadingForm(view) {
  const kind = $("#reading-kind", view).value;
  const text = (id) => $(`#${id}`, view)?.value.trim() ?? "";
  const number = (id) => {
    const raw = $(`#${id}`, view)?.value;
    return raw === undefined || raw === "" ? undefined : Number(raw);
  };
  const location = text("r-location");
  if (!location) throw new Error("Say where the measurement was taken.");
  if (kind === "dimension") {
    const value = number("r-value");
    if (!text("r-what") || !(value > 0)) throw new Error("Enter what you measured and a value above zero.");
    return { kind, what: text("r-what"), value, unit: text("r-unit"), location };
  }
  if (kind === "moisture") {
    const value = number("r-value");
    if (value === undefined || value < 0 || value > 100) throw new Error("Enter a moisture reading between 0 and 100.");
    const reference = number("r-ref");
    return { kind, scale: text("r-scale"), value, location, ...(reference !== undefined ? { reference_value: reference, reference_location: "dry area, same material" } : {}) };
  }
  if (kind === "temperature") {
    const value = number("r-value");
    if (value === undefined) throw new Error("Enter a temperature.");
    return { kind, value, unit: text("r-unit"), location };
  }
  const rh = number("r-rh");
  if (rh === undefined || rh < 0 || rh > 100) throw new Error("Enter relative humidity between 0 and 100.");
  const air = number("r-air");
  return { kind: "humidity", relative_humidity: rh, location, ...(air !== undefined ? { air_temperature: air, unit: text("r-unit") } : {}) };
}

async function addFiles(files, view) {
  const room = MAX_PHOTOS - draft.photos.length;
  if (room <= 0) {
    toast(`You can add up to ${MAX_PHOTOS} photos per inspection.`);
    return;
  }
  const selected = [...files].slice(0, room);
  if (files.length > room) toast(`Only the first ${room} photo${room === 1 ? "" : "s"} were added (limit ${MAX_PHOTOS}).`);
  for (const file of selected) {
    try {
      const photo = await photoFromFile(file);
      draft.photos.push(photo);
      if (photo.quality.warnings.length) toast(QUALITY_MESSAGES[photo.quality.warnings[0]], { tone: "warn", duration: 5000 });
    } catch (error) {
      toast(error.message || "Couldn't read that photo.", { tone: "error" });
    }
  }
  renderPhotos(view);
  syncButtons(view);
}

function storageMessage(error) {
  return error?.name === "QuotaExceededError"
    ? "This device is out of storage for FixSight. Export a backup and delete old inspections in Settings, then try again."
    : `Couldn't save on this device: ${error?.message || "storage error"}`;
}

function syncButtons(view) {
  const hasPhotos = draft.photos.length > 0;
  $("#analyze-btn", view).disabled = !hasPhotos;
  $("#save-draft", view).disabled = !hasPhotos;
  $("#discard", view).disabled = !hasPhotos && !draft.description;
  $("#take-label", view).classList.toggle("is-disabled", draft.photos.length >= MAX_PHOTOS);
}

async function persistDraft(status = "draft") {
  const existing = draft.id ? await db.get("inspections", draft.id) : null;
  const record = {
    ...(existing ?? {
      id: uid("insp"),
      createdAt: new Date().toISOString(),
      notes: [],
      progressPhotos: [],
      checklist: {},
      resolved: false,
      answers: [],
    }),
    photos: draft.photos,
    category: draft.category,
    description: draft.description,
    readings: draft.readings,
    jobId: draft.jobId,
    parentId: draft.parentId,
    status: existing && status === "draft" && existing.status !== "draft" && draft.mode === "add" ? existing.status : status,
  };
  const saved = await db.put("inspections", record);
  if (saved.jobId) {
    const job = await db.get("jobs", saved.jobId);
    if (job && !existing) await db.put("jobs", { ...job, log: [...(job.log ?? []), { at: new Date().toISOString(), text: "Inspection added" }] });
  }
  return saved;
}

function wire(view, ctx) {
  const onFiles = (event) => {
    addFiles(event.target.files, view);
    event.target.value = "";
  };
  $("#take-photo", view).addEventListener("change", onFiles);
  $("#choose-photos", view).addEventListener("change", onFiles);

  view.addEventListener("dragover", (event) => {
    event.preventDefault();
    view.classList.add("dragging");
  });
  view.addEventListener("dragleave", () => view.classList.remove("dragging"));
  view.addEventListener("drop", (event) => {
    event.preventDefault();
    view.classList.remove("dragging");
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files, view);
  });

  $("#photo-list", view).addEventListener("click", async (event) => {
    const tile = event.target.closest(".photo-tile");
    if (!tile) return;
    const index = Number(tile.dataset.index);
    const roleButton = event.target.closest("[data-role]");
    if (roleButton) {
      const role = roleButton.dataset.role;
      draft.photos[index].role = draft.photos[index].role === role ? null : role;
      renderPhotos(view);
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "remove") {
      draft.photos.splice(index, 1);
      renderPhotos(view);
      syncButtons(view);
    } else if (action === "annotate") {
      const updated = await annotatePhoto(draft.photos[index]);
      if (updated) {
        draft.photos[index] = updated;
        renderPhotos(view);
      }
    }
  });

  $("#category-chips", view).addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    draft.category = draft.category === chip.dataset.cat ? "" : chip.dataset.cat;
    $$("#category-chips .chip", view).forEach((element) => {
      const selected = element.dataset.cat === draft.category;
      element.classList.toggle("selected", selected);
      element.setAttribute("aria-pressed", String(selected));
    });
  });

  const description = $("#description", view);
  description.addEventListener("input", () => {
    draft.description = description.value;
    syncButtons(view);
  });

  setupMic(view, ctx, description);

  $("#reading-kind", view).addEventListener("change", () => renderReadingFields(view));
  $("#add-reading", view).addEventListener("click", () => {
    if (draft.readings.length >= 8) {
      toast("Up to 8 measurements per inspection.");
      return;
    }
    try {
      draft.readings.push(readReadingForm(view));
      renderReadings(view);
      renderReadingFields(view);
    } catch (error) {
      toast(error.message, { tone: "warn" });
    }
  });
  $("#reading-list", view).addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-reading]");
    if (!button) return;
    draft.readings.splice(Number(button.dataset.removeReading), 1);
    renderReadings(view);
  });

  $("#job-select", view).addEventListener("change", (event) => {
    draft.jobId = event.target.value || null;
  });

  $("#save-draft", view).addEventListener("click", async () => {
    let saved;
    try {
      saved = await persistDraft("draft");
    } catch (error) {
      toast(storageMessage(error), { tone: "error", duration: 7000 });
      return;
    }
    draft = emptyDraft();
    toast("Draft saved on this device.");
    ctx.navigate(`/inspection/${saved.id}`);
  });

  $("#discard", view).addEventListener("click", async () => {
    if (draft.photos.length && !(await confirmDialog("Discard these photos and start over?", { confirmLabel: "Discard", danger: true }))) return;
    draft = emptyDraft();
    ctx.navigate("/scan");
  });

  $("#analyze-btn", view).addEventListener("click", async () => {
    dictation?.stop();
    let saved;
    try {
      saved = await persistDraft("draft");
    } catch (error) {
      toast(storageMessage(error), { tone: "error", duration: 7000 });
      return;
    }
    draft = emptyDraft();
    if (!ctx.isOnline()) {
      toast("Saved as a draft. Open it from Drafts when you're back online.");
      ctx.navigate(`/inspection/${saved.id}`);
      return;
    }
    await runAnalysis(ctx, saved.id, []);
  });

  document.addEventListener("connection-change", function onChange() {
    if (!document.body.contains(view) || !$("#analyze-btn", view)) {
      document.removeEventListener("connection-change", onChange);
      return;
    }
    $("#analyze-btn", view).textContent = ctx.isOnline() ? "Analyze photos" : "Save draft — analyze when online";
  });
}

async function setupMic(view, ctx, textarea) {
  const micButton = $("#mic-btn", view);
  const status = $("#mic-status", view);
  const caps = ctx.voice.caps;
  const preference = await db.getSetting("dictationEngine", "device");
  const engine = preference === "premium" && caps.premiumDictation
    ? "premium"
    : caps.deviceRecognition ? "device" : caps.premiumDictation ? "premium" : null;
  if (!engine) return;
  micButton.hidden = false;

  const setStatus = (message, isError = false) => {
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("error", isError);
  };
  const reset = () => {
    dictation = null;
    micButton.classList.remove("recording");
    micButton.setAttribute("aria-label", "Dictate a description");
  };

  micButton.addEventListener("click", () => {
    if (dictation) {
      dictation.stop();
      return;
    }
    micButton.classList.add("recording");
    micButton.setAttribute("aria-label", "Stop dictation");
    dictation = startDictation({
      engine,
      onText: (text) => {
        textarea.value = textarea.value.trim() ? `${textarea.value.trim()} ${text}` : text;
        draft.description = textarea.value;
        textarea.dispatchEvent(new Event("input"));
      },
      onStatus: setStatus,
      onEnd: () => {
        reset();
        if (!status.classList.contains("error")) setStatus("");
      },
    });
  });
}

/** Clears the in-progress draft (used by tests and after deletes). */
export function resetDraft() {
  draft = emptyDraft();
}
