"use strict";

// ---------- state ----------
const state = {
  image: null,        // base64, no data: prefix
  mediaType: null,
  thumb: null,        // small data URL for history / loading screen
  category: null,
  description: "",
  questions: [],      // follow-up questions from the model
  result: null
};

const $ = (id) => document.getElementById(id);
const screens = ["screen-capture", "screen-loading", "screen-questions", "screen-result"];

function show(screenId) {
  for (const id of screens) $(id).hidden = id !== screenId;
  window.scrollTo(0, 0);
}

// ---------- photo selection & resize ----------
$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const { dataUrl, thumb } = await resizeImage(file);
    state.image = dataUrl.split(",")[1];
    state.mediaType = "image/jpeg";
    state.thumb = thumb;
    $("photo-preview").src = dataUrl;
    $("photo-preview").hidden = false;
    $("photo-placeholder").hidden = true;
    $("analyze-btn").disabled = false;
  } catch {
    alert("Couldn't read that image — try another photo.");
  }
});

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const make = (maxDim, quality) => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", quality);
      };
      resolve({ dataUrl: make(1568, 0.85), thumb: make(320, 0.7) });
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ---------- category chips ----------
$("category-chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const wasSelected = chip.classList.contains("selected");
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
  if (!wasSelected) {
    chip.classList.add("selected");
    state.category = chip.dataset.cat;
  } else {
    state.category = null;
  }
});

// ---------- analyze ----------
const LOADER_LINES = [
  "Analyzing the photo…",
  "Looking for failure patterns…",
  "Checking likely causes…",
  "Weighing severity and repair options…",
  "Almost there…"
];
let loaderTimer = null;

function startLoader() {
  $("loading-thumb").src = state.thumb || "";
  let i = 0;
  $("loader-text").textContent = LOADER_LINES[0];
  loaderTimer = setInterval(() => {
    i = Math.min(i + 1, LOADER_LINES.length - 1);
    $("loader-text").textContent = LOADER_LINES[i];
  }, 3500);
  show("screen-loading");
}
function stopLoader() { clearInterval(loaderTimer); }

async function analyze(answers) {
  startLoader();
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: [{
          data: state.image,
          media_type: state.mediaType || "image/jpeg"
        }],
        category: state.category,
        description: state.description,
        answers: answers || []
      })
    });
    const data = await res.json();
    stopLoader();
    if (!res.ok) return showError(data.error || "Something went wrong. Please try again.");

    if (data.result_type === "questions" && data.follow_up_questions?.length) {
      state.questions = data.follow_up_questions;
      renderQuestions(data.note);
      show("screen-questions");
    } else if (data.result_type === "diagnosis" && data.diagnosis) {
      state.result = data;
      renderResult(data);
      saveToHistory(data);
      show("screen-result");
    } else if (data.result_type === "retake" || data.result_type === "cannot_assess") {
      state.result = data;
      renderNonDiagnosis(data);
      show("screen-result");
    } else {
      showError(data.note || "This photo couldn't be assessed. Try a clearer shot of the problem area.");
    }
  } catch {
    stopLoader();
    showError("Couldn't reach the FixSight server. Is it running?");
  }
}

$("analyze-btn").addEventListener("click", () => {
  state.description = $("description").value.trim();
  analyze([]);
});

function showError(message) {
  $("result-card").innerHTML = `<div class="error-card">${escapeHtml(message)}</div>`;
  $("copy-summary").hidden = true;
  show("screen-result");
}

// ---------- follow-up questions ----------
function renderQuestions(note) {
  $("questions-note").textContent = note || "A couple of quick questions will sharpen the diagnosis:";
  const form = $("questions-form");
  form.innerHTML = "";
  state.questions.forEach((q, qi) => {
    const block = document.createElement("div");
    block.className = "q-block";
    const opts = (q.options || []).map((o) =>
      `<button type="button" class="q-option" data-q="${qi}">${escapeHtml(o)}</button>`
    ).join("");
    block.innerHTML = `
      <div class="q-text">${escapeHtml(q.question)}</div>
      ${q.why_it_matters ? `<div class="muted">${escapeHtml(q.why_it_matters)}</div>` : ""}
      <div class="q-options">${opts}</div>
      <input type="text" class="q-free" data-q="${qi}" placeholder="Or type your own answer…" />
    `;
    form.appendChild(block);
  });
}

// Enter inside a free-text answer must not submit/reload the page
$("questions-form").addEventListener("submit", (e) => e.preventDefault());

$("questions-form").addEventListener("click", (e) => {
  const form = $("questions-form");
  const btn = e.target.closest(".q-option");
  if (!btn) return;
  const qi = btn.dataset.q;
  form.querySelectorAll(`.q-option[data-q="${qi}"]`).forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  form.querySelector(`.q-free[data-q="${qi}"]`).value = "";
});

$("submit-answers").addEventListener("click", () => {
  const form = $("questions-form");
  const answers = state.questions.map((q, qi) => {
    const selected = form.querySelector(`.q-option[data-q="${qi}"].selected`);
    const free = form.querySelector(`.q-free[data-q="${qi}"]`).value.trim();
    return {
      question_id: q.id,
      question: q.question,
      answer: free || (selected ? selected.textContent : "Not sure")
    };
  });
  analyze(answers);
});

$("skip-questions").addEventListener("click", () => {
  const answers = state.questions.map((q) => ({
    question_id: q.id,
    question: q.question,
    answer: "Not sure - use your best judgment."
  }));
  analyze(answers);
});

// ---------- result rendering ----------
function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function clampNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function labelize(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function confidencePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "Unknown");
  return `${Math.round(clampNumber(number, 0, 1) * 100)}%`;
}

// Keep old localStorage entries readable while rendering the Phase-0 schema.
function diagnosisForDisplay(data) {
  const raw = data?.diagnosis || {};
  const recommendation = raw.recommendation || {};
  const isPhaseZero = Object.prototype.hasOwnProperty.call(raw, "safe_to_diy")
    || Object.prototype.hasOwnProperty.call(raw, "likely_cause");

  if (!isPhaseZero) {
    const legacyPro = raw.diy_or_pro === "pro_required" || raw.diy_or_pro === "pro_recommended";
    return {
      ...raw,
      subject: raw.subject || "",
      confidence: String(raw.confidence || "Unknown"),
      needs_professional: legacyPro,
      professional_type: raw.professional_type || null,
      safe_to_diy: raw.diy_or_pro === "diy" || raw.diy_or_pro === "diy_with_care",
      disclaimer_required: Boolean(raw.disclaimer_required)
    };
  }

  const severity = clampNumber(raw.severity, 0, 10);
  const needsProfessional = Boolean(raw.needs_professional);
  return {
    subject: raw.subject || "",
    likely_diagnosis: raw.diagnosis || "Photo assessment",
    probable_cause: raw.likely_cause || "",
    severity_score: severity,
    severity_label: labelize(raw.urgency) || "Unknown",
    confidence: confidencePercent(raw.confidence),
    diy_or_pro: needsProfessional
      ? "pro_required"
      : (raw.safe_to_diy ? "diy" : "pro_recommended"),
    safe_to_diy: Boolean(raw.safe_to_diy),
    needs_professional: needsProfessional,
    professional_type: raw.professional_type || null,
    difficulty: recommendation.difficulty || "unknown",
    recommended_repair: recommendation.best_fix || "",
    cheapest_safe_fix: recommendation.cheap_or_temp_fix || "",
    temporary_fix: "",
    tools_and_parts: toList(recommendation.tools_or_parts),
    risk_if_ignored: raw.risk_if_ignored || "",
    safety_warnings: toList(raw.safety_warnings),
    disclaimer_required: Boolean(raw.disclaimer_required),
    urgency: raw.urgency || ""
  };
}

const DIY_LABELS = {
  diy: ["Safe to DIY", "diy"],
  diy_with_care: ["DIY with care", "care"],
  pro_recommended: ["Pro recommended", "care"],
  pro_required: ["Call a professional", "pro"]
};

function severityColor(score) {
  if (score <= 2) return "#2e8b57";
  if (score <= 4) return "#7aa832";
  if (score <= 6) return "#d9a11a";
  if (score <= 8) return "#d97a1a";
  return "#c93a3a";
}

function renderResult(data, photoDataUrl) {
  const d = diagnosisForDisplay(data);
  const [diyLabel, diyClass] = DIY_LABELS[d.diy_or_pro] || ["", ""];
  const color = severityColor(d.severity_score);
  const photo = photoDataUrl || state.thumb || null;
  const imageQuality = data.image_quality ? labelize(data.image_quality) : "";
  const professional = d.professional_type || "qualified professional";
  const proCta = d.needs_professional || !d.safe_to_diy
    ? `<div class="warn-card"><strong>Professional help recommended</strong><div>${
        d.safe_to_diy
          ? `Contact a ${escapeHtml(professional)} before making the full repair.`
          : `Do not attempt this repair yourself. Contact a ${escapeHtml(professional)}.`
      }</div></div>`
    : "";
  const retakeGuidance = toList(data.retake_guidance);
  const guidanceCard = retakeGuidance.length
    ? infoCard("Photo guidance", `<ul>${retakeGuidance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`)
    : "";
  const disclaimerCard = d.disclaimer_required
    ? infoCard("Important limitation", "This is a photo-based first opinion, not an on-site inspection. Confirm safety-critical work with a qualified professional.")
    : "";

  const warnings = (d.safety_warnings || []).length
    ? `<div class="warn-card"><strong>⚠ Safety</strong><ul>${d.safety_warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
    : "";

  const tools = (d.tools_and_parts || []).length
    ? infoCard("Tools & parts", `<ul>${d.tools_and_parts.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`)
    : "";

  $("result-card").innerHTML = `
    ${photo ? `<img class="result-photo" src="${photo}" alt="Scanned photo" />` : ""}
    <div class="diag-head">
      <div class="diag-title">${escapeHtml(d.likely_diagnosis)}</div>
      ${d.subject ? `<div class="muted">${escapeHtml(d.subject)}</div>` : ""}
      <div class="badges">
        <span class="badge ${diyClass}">${diyLabel}</span>
        <span class="badge">Difficulty: ${escapeHtml(d.difficulty)}</span>
        <span class="badge">Confidence: ${escapeHtml(d.confidence)}</span>
        ${imageQuality ? `<span class="badge">Image: ${escapeHtml(imageQuality)}</span>` : ""}
      </div>
      <div class="severity">
        <div class="severity-top">
          <span>Severity: ${escapeHtml(d.severity_label)}</span>
          <span style="color:${color}">${d.severity_score}/10</span>
        </div>
        <div class="severity-track">
          <div class="severity-fill" style="width:${d.severity_score * 10}%;background:${color}"></div>
        </div>
      </div>
    </div>
    ${warnings}
    ${proCta}
    ${guidanceCard}
    ${data.note ? infoCard("What we noticed", escapeHtml(data.note)) : ""}
    ${infoCard("Probable cause", escapeHtml(d.probable_cause))}
    ${infoCard("Recommended repair", escapeHtml(d.recommended_repair))}
    ${d.cheapest_safe_fix ? infoCard("Cheapest safe or temporary fix", escapeHtml(d.cheapest_safe_fix)) : ""}
    ${d.temporary_fix ? infoCard("Temporary fix", escapeHtml(d.temporary_fix)) : ""}
    ${tools}
    ${infoCard("If you ignore it", escapeHtml(d.risk_if_ignored))}
    ${d.estimated_cost_range ? infoCard("Estimated cost", `<span class="cost">${escapeHtml(d.estimated_cost_range)}</span>`) : ""}
    ${disclaimerCard}
  `;
  $("copy-summary").hidden = false;
  $("copy-summary").textContent = "Copy repair summary";
}

function renderNonDiagnosis(data) {
  const isRetake = data.result_type === "retake";
  const title = isRetake ? "Retake the photo" : "Unable to assess safely";
  const guidance = toList(data.retake_guidance);
  const photo = state.thumb || null;
  const quality = data.image_quality ? labelize(data.image_quality) : "Unknown";

  $("result-card").innerHTML = `
    ${photo ? `<img class="result-photo" src="${photo}" alt="Scanned photo" />` : ""}
    <div class="diag-head">
      <div class="diag-title">${title}</div>
      <div class="badges"><span class="badge">Image: ${escapeHtml(quality)}</span></div>
    </div>
    ${data.note ? `<div class="note-card">${escapeHtml(data.note)}</div>` : ""}
    ${guidance.length
      ? infoCard(
          isRetake ? "How to retake it" : "What may help",
          `<ul>${guidance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        )
      : ""}
    ${!isRetake
      ? `<div class="warn-card"><strong>Do not guess on a safety-critical repair.</strong><div>If the issue could involve electrical, gas, fire, structural, or active water hazards, contact a qualified professional.</div></div>`
      : ""}
  `;
  $("copy-summary").hidden = true;
}

function infoCard(label, bodyHtml) {
  return `<div class="info-card"><div class="info-label">${label}</div><div class="info-body">${bodyHtml}</div></div>`;
}

function buildShareSummary(data) {
  if (!data?.diagnosis) return "";
  const d = diagnosisForDisplay(data);
  const tools = toList(d.tools_and_parts);
  const warnings = toList(d.safety_warnings);
  const professional = d.needs_professional || !d.safe_to_diy
    ? `Professional: Contact a ${d.professional_type || "qualified professional"}.`
    : "DIY: The suggested work is considered safe to DIY with normal precautions.";

  return [
    "FixSight photo assessment",
    d.subject ? `Subject: ${d.subject}` : "",
    `Diagnosis: ${d.likely_diagnosis}`,
    d.probable_cause ? `Likely cause: ${d.probable_cause}` : "",
    `Severity: ${d.severity_score}/10 (${d.severity_label})`,
    `Confidence: ${d.confidence}`,
    professional,
    d.recommended_repair ? `Best fix: ${d.recommended_repair}` : "",
    d.cheapest_safe_fix ? `Cheaper/temporary option: ${d.cheapest_safe_fix}` : "",
    tools.length ? `Tools or parts: ${tools.join(", ")}` : "",
    d.risk_if_ignored ? `Risk if ignored: ${d.risk_if_ignored}` : "",
    warnings.length ? `Safety: ${warnings.join(" ")}` : "",
    data.note ? `Note: ${data.note}` : "",
    d.disclaimer_required
      ? "Photo-based first opinion only; confirm safety-critical work with an on-site professional."
      : ""
  ].filter(Boolean).join("\n");
}

$("copy-summary").addEventListener("click", async () => {
  const summary = buildShareSummary(state.result);
  if (!summary) return;
  try {
    await navigator.clipboard.writeText(summary);
    $("copy-summary").textContent = "Copied ✓ — paste it anywhere";
  } catch {
    prompt("Copy this summary:", summary);
  }
});

// ---------- history (localStorage) ----------
const HISTORY_KEY = "fixsight_history";

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveToHistory(data) {
  const items = loadHistory();
  items.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    thumb: state.thumb,
    category: state.category,
    result: data
  });
  // keep the 20 most recent scans; drop thumbnails first if storage is full
  while (items.length > 20) items.pop();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    items.forEach((i) => delete i.thumb);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch { /* give up quietly */ }
  }
  renderHistory();
}

function renderHistory() {
  const items = loadHistory();
  $("history-section").hidden = items.length === 0;
  $("history-list").innerHTML = items.map((item) => {
    const d = diagnosisForDisplay(item.result);
    const date = new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `
      <div class="history-item" data-id="${item.id}">
        ${item.thumb ? `<img src="${item.thumb}" alt="" />` : `<img alt="" />`}
        <div>
          <div class="history-title">${escapeHtml(d.likely_diagnosis)}</div>
          <div class="history-meta">${date} · severity ${d.severity_score}/10${item.category ? ` · ${escapeHtml(item.category)}` : ""}</div>
        </div>
      </div>`;
  }).join("");
}

$("history-list").addEventListener("click", (e) => {
  const el = e.target.closest(".history-item");
  if (!el) return;
  const item = loadHistory().find((i) => i.id === Number(el.dataset.id));
  if (!item) return;
  state.result = item.result;
  renderResult(item.result, item.thumb);
  show("screen-result");
});

$("clear-history").addEventListener("click", () => {
  if (confirm("Delete all saved scans?")) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
});

// ---------- navigation ----------
function resetToHome() {
  state.image = null;
  state.thumb = null;
  state.questions = [];
  state.result = null;
  $("photo-input").value = "";
  $("photo-preview").hidden = true;
  $("photo-placeholder").hidden = false;
  $("analyze-btn").disabled = true;
  renderHistory();
  show("screen-capture");
}

$("new-scan").addEventListener("click", resetToHome);
$("brand-home").addEventListener("click", resetToHome);

// ---------- utils ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

renderHistory();
