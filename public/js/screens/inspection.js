// Inspection detail: running analyses, questions, results, comparison, and
// everything you can do with a saved inspection.

import * as api from "../api.js";
import * as db from "../db.js";
import {
  buildShareText,
  buildSpeechText,
  displayDiagnosis,
  inspectionTitle,
  renderDiagnosis,
  renderNonDiagnosis,
  renderSafetyNotices,
  severityTone,
} from "../analysis-view.js";
import { photoFromFile } from "../photos.js";
import { buildPdf } from "../report.js";
import {
  $, $$, addDays, confirmDialog, downloadBlob, formatDate, formatDateTime, html, openModal, raw, setHtml, slugify, toast, uid,
} from "../ui.js";
import { listenForCommands } from "../voice.js";

const STATUS_LABELS = {
  draft: "Draft — not analyzed",
  awaiting_answers: "Waiting for your answers",
  complete: "Assessed",
  retake: "Retake requested",
  cannot_assess: "Could not assess",
};

// ---------- running an analysis ----------

const LOADING_LINES = [
  "Analyzing your photos…",
  "Looking at what's visible…",
  "Separating what's seen from what's likely…",
  "Checking safety concerns…",
  "Working out repair options and costs…",
  "Almost there…",
];

let inFlight = null;

function showLoading(thumb, onCancel) {
  const overlay = $("#loading");
  $("#loading-thumb").src = thumb || "";
  let line = 0;
  $("#loading-text").textContent = LOADING_LINES[0];
  const timer = setInterval(() => {
    line = Math.min(line + 1, LOADING_LINES.length - 1);
    $("#loading-text").textContent = LOADING_LINES[line];
  }, 6000);
  overlay.hidden = false;
  const cancel = $("#loading-cancel");
  const handler = () => onCancel();
  cancel.addEventListener("click", handler, { once: true });
  return () => {
    clearInterval(timer);
    overlay.hidden = true;
    cancel.removeEventListener("click", handler);
  };
}

function statusFor(resultType) {
  return { questions: "awaiting_answers", diagnosis: "complete", retake: "retake", cannot_assess: "cannot_assess" }[resultType] ?? "draft";
}

/**
 * Sends a saved inspection for analysis and stores the result. The record is
 * saved before the request, so a failure never loses photos: it stays a draft.
 */
export async function runAnalysis(ctx, inspectionId, answers = []) {
  if (inFlight) {
    toast("An analysis is already running.");
    return;
  }
  const inspection = await db.get("inspections", inspectionId);
  if (!inspection) throw new Error("Inspection not found.");
  if (!inspection.photos?.length) {
    toast("Add at least one photo first.", { tone: "warn" });
    ctx.navigate(`/scan?add=${inspection.id}`);
    return;
  }
  const controller = new AbortController();
  inFlight = controller;
  const hide = showLoading(inspection.photos[0].thumb, () => controller.abort());
  try {
    const analysis = await api.analyze(inspection, answers, controller.signal);
    const followUp = analysis.diagnosis?.follow_up;
    const updated = await db.put("inspections", {
      ...inspection,
      analysis,
      answers,
      status: statusFor(analysis.result_type),
      analyzedAt: new Date().toISOString(),
      followUpDue: followUp ? addDays(new Date().toISOString(), followUp.reinspect_in_days) : null,
      lastError: null,
    });
    hide();
    inFlight = null;
    if (analysis.result_type === "questions") ctx.navigate(`/inspection/${updated.id}/questions`);
    else ctx.navigate(`/inspection/${updated.id}`);
  } catch (error) {
    hide();
    inFlight = null;
    if (error.code === "cancelled") {
      toast("Cancelled. The inspection is saved as a draft.");
    } else {
      await db.put("inspections", { ...inspection, lastError: error.message });
      toast(error.message, { tone: "error", duration: 7000 });
      if (error.code === "access_code_required") {
        ctx.navigate("/settings");
        return;
      }
    }
    ctx.navigate(`/inspection/${inspection.id}`);
  }
}

// ---------- questions ----------

export async function renderQuestions(view, id, ctx) {
  const inspection = await db.get("inspections", id);
  if (!inspection) throw new Error("Inspection not found.");
  const questions = inspection.analysis?.follow_up_questions ?? [];
  if (inspection.analysis?.result_type !== "questions" || !questions.length) {
    ctx.navigate(`/inspection/${id}`);
    return;
  }
  setHtml(view, html`
    <h1 class="screen-title">A few quick questions</h1>
    ${renderSafetyNotices(inspection.analysis)}
    <div class="note-card">${inspection.analysis.note}</div>
    <form id="questions-form" class="questions">
      ${questions.map((question, index) => html`
        <fieldset class="q-block">
          <legend class="q-text">${index + 1}. ${question.question}</legend>
          <p class="muted small">${question.why_it_matters}</p>
          <div class="q-options">
            ${question.options.map((option) => html`
              <label class="q-option"><input type="radio" name="q-${index}" value="${option}" /> <span>${option}</span></label>`)}
          </div>
          <label class="small muted" for="q-free-${index}">Or answer in your own words</label>
          <input type="text" id="q-free-${index}" class="q-free" data-q="${index}" maxlength="500" />
        </fieldset>`)}
    </form>
    <div class="sticky-actions">
      <button type="button" id="submit-answers" class="btn btn-accent btn-big">Get my assessment</button>
      <button type="button" id="skip-questions" class="btn btn-ghost">Skip — use what you have</button>
    </div>`);

  const collect = (skip) => questions.map((question, index) => {
    const free = $(`#q-free-${index}`, view).value.trim();
    const selected = $(`input[name="q-${index}"]:checked`, view)?.value;
    return {
      question_id: question.id,
      question: question.question,
      answer: skip ? "Not sure — use your best judgment." : free || selected || "Not sure",
    };
  });
  $("#questions-form", view).addEventListener("submit", (event) => event.preventDefault());
  $("#submit-answers", view).addEventListener("click", () => runAnalysis(ctx, id, collect(false)));
  $("#skip-questions", view).addEventListener("click", () => runAnalysis(ctx, id, collect(true)));
}

// ---------- detail ----------

async function relatedRecords(inspection) {
  const job = inspection.jobId ? await db.get("jobs", inspection.jobId) : null;
  const customer = job?.customerId ? await db.get("customers", job.customerId) : null;
  const parent = inspection.parentId ? await db.get("inspections", inspection.parentId) : null;
  const children = await db.byIndex("inspections", "parentId", inspection.id);
  return { job, customer, parent, children };
}

export async function renderDetail(view, id, ctx) {
  const inspection = await db.get("inspections", id);
  if (!inspection) throw new Error("This inspection no longer exists.");
  const { job, customer, parent, children } = await relatedRecords(inspection);
  const analysis = inspection.analysis;
  const jobs = await db.listJobs();
  const online = ctx.isOnline();
  const canRead = ctx.voice.caps.deviceSpeech || ctx.voice.caps.premiumSpeech;

  let body;
  if (!analysis) {
    body = html`<section class="diag-head"><h2 class="diag-title">Not analyzed yet</h2>
      <p class="muted">This inspection is saved on your device. ${online ? "Analyze it now, or add more photos first." : "Analyze it when you're back online."}</p>
      ${inspection.lastError ? html`<p class="alert alert-warn small">Last attempt: ${inspection.lastError}</p>` : ""}
      <div class="btn-row"><button type="button" class="btn btn-accent" data-action="analyze" ${online ? "" : raw("disabled")}>Analyze now</button>
      <a class="btn btn-secondary" href="#/scan?add=${inspection.id}">Edit photos</a></div></section>`;
  } else if (analysis.result_type === "questions") {
    body = html`${renderSafetyNotices(analysis)}<section class="diag-head"><h2 class="diag-title">Waiting for your answers</h2>
      <a class="btn btn-accent" href="#/inspection/${inspection.id}/questions">Answer questions</a></section>`;
  } else if (analysis.diagnosis) {
    body = renderDiagnosis(analysis, { checklistState: inspection.checklist ?? {} });
  } else {
    body = html`${renderNonDiagnosis(analysis)}${analysis.result_type === "retake"
      ? html`<a class="btn btn-accent btn-big" href="#/scan?retake=${inspection.id}">Retake photos</a>` : ""}`;
  }

  const d = analysis?.diagnosis ? displayDiagnosis(analysis.diagnosis) : null;

  setHtml(view, html`
    <div class="detail-head">
      <a href="#/inspections" class="back-link">‹ History</a>
      <span class="status-pill" data-status="${inspection.status}">${STATUS_LABELS[inspection.status] ?? inspection.status}</span>
      ${inspection.resolved ? html`<span class="status-pill" data-status="resolved">Resolved</span>` : ""}
    </div>
    <p class="muted small">${formatDateTime(inspection.createdAt)}${inspection.category ? ` · ${inspection.category}` : ""}${job ? html` · <a href="#/job/${job.id}">${job.title}</a>` : ""}${customer ? ` · ${customer.name}` : ""} · <span title="Stored only on this device">Saved on this device</span></p>
    ${inspection.legacy ? html`<p class="note-card small">Imported from FixSight's earlier history. Only a thumbnail photo was kept.</p>` : ""}

    <div class="detail-grid">
      <div class="detail-main">
        <div class="gallery">${(inspection.photos ?? []).map((photo, index) => html`
          <button type="button" class="gallery-item" data-photo="${index}" aria-label="View photo ${index + 1}"><img src="${photo.thumb || photo.dataUrl}" alt="Inspection photo ${index + 1}" />
          ${photo.annotated ? html`<span class="gallery-tag">Marked</span>` : ""}</button>`)}</div>
        <div id="result-body" class="result-body">${body}</div>
      </div>

      <aside class="detail-side">
        <section class="panel actions-panel" aria-label="Actions">
          <h2 class="panel-title">Actions</h2>
          ${analysis && analysis.result_type !== "questions" ? html`
            <button type="button" class="btn btn-primary" data-action="pdf">Download PDF report</button>
            <button type="button" class="btn btn-secondary" data-action="share">Share summary</button>
            <button type="button" class="btn btn-secondary" data-action="print">Print</button>` : ""}
          ${canRead && analysis ? html`<div class="read-controls" id="read-controls">
            <button type="button" class="btn btn-secondary" data-action="read">🔊 Read aloud</button>
            <button type="button" class="btn btn-ghost" data-action="read-toggle" hidden>Pause</button>
            <button type="button" class="btn btn-ghost" data-action="read-stop" hidden>Stop</button></div>` : ""}
          ${d?.recommendation.repair_steps.length ? html`<button type="button" class="btn btn-secondary" data-action="step-mode">Hands-free repair steps</button>` : ""}
          ${analysis?.diagnosis ? html`<a class="btn btn-secondary" href="#/scan?parent=${inspection.id}">Follow-up check (new photos)</a>` : ""}
          ${parent ? html`<a class="btn btn-secondary" href="#/compare/${inspection.id}">Compare with earlier</a>` : ""}
          ${analysis && analysis.result_type !== "questions" ? html`<button type="button" class="btn btn-ghost" data-action="reanalyze" ${online ? "" : raw("disabled")}>Re-analyze</button>` : ""}
        </section>

        <section class="panel">
          <h2 class="panel-title">Job</h2>
          <select id="link-job" aria-label="Linked job">
            <option value="">Not linked to a job</option>
            ${jobs.map((item) => html`<option value="${item.id}" ${item.id === inspection.jobId ? raw("selected") : ""}>${item.title}</option>`)}
          </select>
          <a class="small" href="#/job/new${inspection.id ? `?inspection=${inspection.id}` : ""}">+ New job for this inspection</a>
        </section>

        ${analysis?.diagnosis ? html`<section class="panel">
          <h2 class="panel-title">Status</h2>
          <label class="check"><input type="checkbox" id="resolved" ${inspection.resolved ? raw("checked") : ""} /> <span>Marked as resolved</span></label>
          <textarea id="resolution-note" rows="2" maxlength="2000" placeholder="What was done (optional)" aria-label="Resolution note">${inspection.resolutionNote ?? ""}</textarea>
          ${inspection.followUpDue ? html`<p class="small muted">Follow-up check due ${formatDate(inspection.followUpDue)}</p>` : ""}
        </section>` : ""}

        <section class="panel">
          <h2 class="panel-title">Repair progress photos</h2>
          <p class="muted small">Document before, during, and after repair. These aren't sent for analysis.</p>
          <div class="progress-grid">${(inspection.progressPhotos ?? []).map((photo, index) => html`
            <figure class="progress-item"><img src="${photo.thumb}" alt="${photo.stage} photo" /><figcaption class="small"><strong>${photo.stage}</strong> · ${formatDate(photo.addedAt)}${photo.caption ? html`<br />${photo.caption}` : ""}
            <button type="button" class="link-btn" data-remove-progress="${index}">Remove</button></figcaption></figure>`)}</div>
          <div class="inline-fields">
            <select id="progress-stage" aria-label="Stage"><option value="before">Before</option><option value="during">During</option><option value="after" selected>After</option></select>
            <input type="text" id="progress-caption" maxlength="200" placeholder="Caption (optional)" aria-label="Caption" />
          </div>
          <label class="btn btn-secondary btn-small photo-pick"><input type="file" id="progress-file" accept="image/*" capture="environment" hidden />Add progress photo</label>
        </section>

        <section class="panel">
          <h2 class="panel-title">Notes</h2>
          <ul class="notes">${(inspection.notes ?? []).map((note) => html`<li><span class="muted small">${formatDateTime(note.at)}</span><br />${note.text}</li>`)}</ul>
          <textarea id="note-text" rows="2" maxlength="2000" placeholder="Add a note" aria-label="New note"></textarea>
          <button type="button" class="btn btn-secondary btn-small" data-action="add-note">Add note</button>
        </section>

        ${children.length ? html`<section class="panel"><h2 class="panel-title">Follow-up checks</h2>
          <ul class="link-list">${children.map((child) => html`<li><a href="#/inspection/${child.id}">${inspectionTitle(child)}</a> <span class="muted small">${formatDate(child.createdAt)}</span></li>`)}</ul></section>` : ""}

        <button type="button" class="btn btn-danger-ghost" data-action="delete">Delete inspection</button>
      </aside>
    </div>`);

  wireDetail(view, inspection, { job, customer, parent }, ctx);
}

function wireDetail(view, inspection, related, ctx) {
  const save = async (patch) => {
    const current = await db.get("inspections", inspection.id);
    Object.assign(inspection, await db.put("inspections", { ...current, ...patch }));
  };

  view.addEventListener("change", async (event) => {
    const box = event.target.closest("[data-check]");
    if (box) {
      const kind = box.dataset.check;
      const checklist = structuredClone(inspection.checklist ?? {});
      checklist[kind] = { ...(checklist[kind] ?? {}), [box.dataset.index]: box.checked };
      await save({ checklist });
    }
  });

  $("#link-job", view)?.addEventListener("change", async (event) => {
    const jobId = event.target.value || null;
    await save({ jobId });
    if (jobId) {
      const job = await db.get("jobs", jobId);
      if (job) await db.put("jobs", { ...job, log: [...(job.log ?? []), { at: new Date().toISOString(), text: `Linked inspection: ${inspectionTitle(inspection)}` }] });
    }
    toast(jobId ? "Linked to job." : "Unlinked from job.");
    ctx.rerender();
  });

  $("#resolved", view)?.addEventListener("change", async (event) => {
    await save({ resolved: event.target.checked, resolutionNote: $("#resolution-note", view).value.trim() || null });
    toast(event.target.checked ? "Marked resolved." : "Marked open.");
  });
  $("#resolution-note", view)?.addEventListener("change", async (event) => {
    await save({ resolutionNote: event.target.value.trim() || null });
  });

  $("#progress-file", view).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const photo = await photoFromFile(file);
      const progressPhotos = [...(inspection.progressPhotos ?? []), {
        id: uid("prog"),
        dataUrl: photo.dataUrl,
        thumb: photo.thumb,
        stage: $("#progress-stage", view).value,
        caption: $("#progress-caption", view).value.trim(),
        addedAt: new Date().toISOString(),
      }];
      await save({ progressPhotos });
      toast("Progress photo added.");
      ctx.rerender();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  });

  view.addEventListener("click", async (event) => {
    const removeProgress = event.target.closest("[data-remove-progress]");
    if (removeProgress) {
      const progressPhotos = [...(inspection.progressPhotos ?? [])];
      progressPhotos.splice(Number(removeProgress.dataset.removeProgress), 1);
      await save({ progressPhotos });
      ctx.rerender();
      return;
    }
    const photoButton = event.target.closest("[data-photo]");
    if (photoButton) {
      const photo = inspection.photos[Number(photoButton.dataset.photo)];
      openModal((dialog, close) => {
        dialog.classList.add("modal-wide");
        setHtml(dialog, html`<img class="photo-full" src="${photo.dataUrl}" alt="Inspection photo" /><div class="modal-actions"><button type="button" class="btn btn-secondary">Close</button></div>`);
        dialog.querySelector("button").addEventListener("click", () => close());
      }, { label: "Photo" });
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "analyze" || action === "reanalyze") {
      if (action === "reanalyze" && !(await confirmDialog("Run a new analysis of these photos? This replaces the current result and uses a paid analysis.", { confirmLabel: "Re-analyze" }))) return;
      await runAnalysis(ctx, inspection.id, []);
    } else if (action === "add-photos-rerun") {
      ctx.navigate(`/scan?add=${inspection.id}`);
    } else if (action === "pdf") {
      await downloadPdf(inspection, related);
    } else if (action === "share") {
      await share(inspection, related);
    } else if (action === "print") {
      window.print();
    } else if (action === "read") {
      const engine = (await db.getSetting("readAloudEngine", "device")) === "premium" && ctx.voice.caps.premiumSpeech ? "premium" : "device";
      try {
        await ctx.reader.speak(buildSpeechText(inspection.analysis), { engine });
      } catch (error) {
        toast(error.message || "Couldn't read aloud.", { tone: "error" });
        ctx.reader.stop();
      }
    } else if (action === "read-toggle") {
      ctx.reader.toggle();
    } else if (action === "read-stop") {
      ctx.reader.stop();
    } else if (action === "step-mode") {
      await stepMode(inspection, ctx, save);
    } else if (action === "add-note") {
      const text = $("#note-text", view).value.trim();
      if (!text) return;
      await save({ notes: [...(inspection.notes ?? []), { at: new Date().toISOString(), text }] });
      ctx.rerender();
    } else if (action === "delete") {
      if (!(await confirmDialog("Delete this inspection and its photos from this device? This can't be undone.", { confirmLabel: "Delete", danger: true }))) return;
      for (const child of await db.byIndex("inspections", "parentId", inspection.id)) {
        await db.put("inspections", { ...child, parentId: null });
      }
      await db.remove("inspections", inspection.id);
      toast("Inspection deleted.");
      ctx.navigate("/inspections");
    }
  });

  // Coming back online (or dropping off) updates the analysis buttons in place.
  document.addEventListener("connection-change", function onConnection() {
    if (!document.body.contains(view)) {
      document.removeEventListener("connection-change", onConnection);
      return;
    }
    $$('[data-action="analyze"], [data-action="reanalyze"]', view).forEach((button) => {
      button.disabled = !ctx.isOnline();
    });
  });

  const controls = $("#read-controls", view);
  if (controls) {
    const onState = (event) => {
      if (!document.body.contains(controls)) {
        document.removeEventListener("reader-state", onState);
        return;
      }
      const state = event.detail;
      const [read, toggle, stop] = $$("button", controls);
      read.hidden = state !== "idle";
      toggle.hidden = state === "idle" || state === "loading";
      stop.hidden = state === "idle";
      toggle.textContent = state === "paused" ? "Resume" : "Pause";
      read.disabled = state === "loading";
    };
    document.addEventListener("reader-state", onState);
  }
}

async function businessProfile() {
  return db.getSetting("business", {});
}

async function downloadPdf(inspection, { job, customer, parent }) {
  toast("Preparing PDF…", { duration: 8000 });
  try {
    const blob = await buildPdf({
      inspections: [inspection],
      job,
      customer,
      business: await businessProfile(),
      earlierById: parent ? { [inspection.id]: parent } : {},
    });
    downloadBlob(blob, `fixsight-${slugify(inspectionTitle(inspection))}-${inspection.createdAt.slice(0, 10)}.pdf`);
    toast("PDF report downloaded.");
  } catch (error) {
    toast(error.message || "Couldn't create the PDF.", { tone: "error" });
  }
}

async function share(inspection, { job, customer }) {
  const text = buildShareText(inspection, { job, customer });
  if (navigator.share) {
    try {
      await navigator.share({ title: "FixSight inspection", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Summary copied — paste it anywhere.");
  } catch {
    openModal((dialog, close) => {
      setHtml(dialog, html`<h2 class="modal-title">Copy this summary</h2><textarea class="share-text" rows="12" readonly>${text}</textarea><div class="modal-actions"><button type="button" class="btn btn-secondary">Done</button></div>`);
      dialog.querySelector("textarea").select();
      dialog.querySelector("button").addEventListener("click", () => close());
    }, { label: "Summary" });
  }
}

// ---------- hands-free step mode ----------

async function stepMode(inspection, ctx, save) {
  const steps = displayDiagnosis(inspection.analysis.diagnosis).recommendation.repair_steps;
  if (!steps.length) return;
  const checklist = structuredClone(inspection.checklist ?? {});
  const done = checklist.steps ?? {};
  let index = Math.max(0, steps.findIndex((_step, i) => !done[i]));
  if (index < 0 || index >= steps.length) index = 0;
  let speakSteps = ctx.voice.caps.deviceSpeech;
  let listener = null;

  await openModal((dialog, close) => {
    dialog.classList.add("modal-full", "step-mode");
    const canListen = ctx.voice.caps.deviceRecognition;

    function speak() {
      if (speakSteps) ctx.reader.speak(`Step ${index + 1} of ${steps.length}. ${steps[index]}`).catch(() => {});
    }
    function draw() {
      setHtml(dialog, html`
        <div class="step-top"><span class="muted">Step ${index + 1} of ${steps.length}</span>
          <button type="button" class="btn btn-ghost" data-step="exit">Close</button></div>
        <div class="step-progress"><div style="width:${((index + 1) / steps.length) * 100}%"></div></div>
        <p class="step-text" aria-live="assertive">${steps[index]}</p>
        <label class="check step-done"><input type="checkbox" data-step="toggle" ${done[index] ? raw("checked") : ""} /> <span>Done</span></label>
        <div class="step-nav">
          <button type="button" class="btn btn-secondary btn-big" data-step="back" ${index === 0 ? raw("disabled") : ""}>‹ Back</button>
          <button type="button" class="btn btn-secondary btn-big" data-step="repeat">Repeat</button>
          <button type="button" class="btn btn-accent btn-big" data-step="next">${index === steps.length - 1 ? "Finish" : "Next ›"}</button>
        </div>
        <div class="step-options">
          ${ctx.voice.caps.deviceSpeech ? html`<label class="check"><input type="checkbox" data-step="speak" ${speakSteps ? raw("checked") : ""} /> <span>Read steps aloud</span></label>` : ""}
          ${canListen ? html`<label class="check"><input type="checkbox" data-step="listen" ${listener ? raw("checked") : ""} /> <span>Voice commands: say "next", "back", "repeat", or "stop"</span></label>` : ""}
          <p class="small muted" id="step-status"></p>
        </div>`);
    }
    async function act(command) {
      if (command === "exit") {
        finish();
        return;
      }
      if (command === "next") {
        done[index] = true;
        checklist.steps = done;
        // Advance immediately; the save runs in the background.
        save({ checklist }).catch(() => toast("Couldn't save step progress.", { tone: "error" }));
        if (index === steps.length - 1) {
          finish();
          return;
        }
        index += 1;
      } else if (command === "back" && index > 0) {
        index -= 1;
      }
      draw();
      speak();
    }
    function finish() {
      listener?.stop();
      ctx.reader.stop();
      close();
    }
    dialog.addEventListener("click", (event) => {
      const command = event.target.closest("button[data-step]")?.dataset.step;
      if (command) act(command);
    });
    dialog.addEventListener("change", async (event) => {
      const kind = event.target.dataset.step;
      if (kind === "toggle") {
        done[index] = event.target.checked;
        checklist.steps = done;
        await save({ checklist });
      } else if (kind === "speak") {
        speakSteps = event.target.checked;
        if (!speakSteps) ctx.reader.stop();
      } else if (kind === "listen") {
        if (event.target.checked) {
          listener = listenForCommands((command) => act(command), (message) => {
            const status = dialog.querySelector("#step-status");
            if (status) status.textContent = message;
          });
          if (!listener) event.target.checked = false;
        } else {
          listener?.stop();
          listener = null;
        }
      }
    });
    draw();
    speak();
  }, { label: "Hands-free repair steps" });
  listener?.stop();
  ctx.rerender();
}

// ---------- before / after comparison ----------

export async function renderCompare(view, id, ctx) {
  const current = await db.get("inspections", id);
  if (!current) throw new Error("Inspection not found.");
  const earlier = current.parentId ? await db.get("inspections", current.parentId) : null;
  if (!earlier) {
    ctx.navigate(`/inspection/${id}`);
    return;
  }
  const before = earlier.photos?.[0];
  const after = current.photos?.[0];
  const beforeFinding = earlier.analysis?.diagnosis ? displayDiagnosis(earlier.analysis.diagnosis) : null;
  const afterFinding = current.analysis?.diagnosis ? displayDiagnosis(current.analysis.diagnosis) : null;
  const delta = beforeFinding && afterFinding ? afterFinding.severity - beforeFinding.severity : null;

  setHtml(view, html`
    <div class="detail-head"><a href="#/inspection/${id}" class="back-link">‹ Back to inspection</a></div>
    <h1 class="screen-title">Before &amp; after</h1>
    <p class="note-card small">A side-by-side view helps you judge visible change. It can't prove an underlying cause is fixed, and photos taken from different angles or light can look different.</p>
    ${before && after ? html`
      <div class="compare-slider" id="compare-slider" style="--pos:50%">
        <img src="${after.dataUrl}" alt="Current photo" class="compare-after" />
        <div class="compare-before-wrap"><img src="${before.dataUrl}" alt="Earlier photo" class="compare-before" /></div>
        <div class="compare-handle" aria-hidden="true"></div>
        <input type="range" min="0" max="100" value="50" class="compare-range" aria-label="Drag to compare earlier and current photos" />
        <span class="compare-label compare-label-left">Earlier</span><span class="compare-label compare-label-right">Current</span>
      </div>` : ""}
    <div class="compare-grid">
      <section class="panel">
        <h2 class="panel-title">Earlier · ${formatDate(earlier.createdAt)}</h2>
        ${before ? html`<img class="compare-photo" src="${before.dataUrl}" alt="Earlier photo" />` : ""}
        ${beforeFinding ? html`<p><strong>${beforeFinding.diagnosis}</strong></p><p class="severity-chip" data-tone="${severityTone(beforeFinding.severity)}">Severity ${beforeFinding.severity}/10</p>` : html`<p class="muted">No assessment.</p>`}
        <a href="#/inspection/${earlier.id}" class="small">Open earlier inspection</a>
      </section>
      <section class="panel">
        <h2 class="panel-title">Current · ${formatDate(current.createdAt)}</h2>
        ${after ? html`<img class="compare-photo" src="${after.dataUrl}" alt="Current photo" />` : ""}
        ${afterFinding ? html`<p><strong>${afterFinding.diagnosis}</strong></p><p class="severity-chip" data-tone="${severityTone(afterFinding.severity)}">Severity ${afterFinding.severity}/10</p>` : html`<p class="muted">Not analyzed yet.</p>`}
      </section>
    </div>
    ${delta !== null ? html`<p class="center">${delta < 0 ? `Assessed severity went down by ${-delta}.` : delta > 0 ? `Assessed severity went up by ${delta}.` : "Assessed severity is unchanged."} <span class="muted small">(Each assessment is independent and approximate.)</span></p>` : ""}`);

  const slider = $("#compare-slider", view);
  slider?.querySelector(".compare-range").addEventListener("input", (event) => {
    slider.style.setProperty("--pos", `${event.target.value}%`);
  });
}
