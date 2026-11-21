// Rendering of analyses: result view, share text, and read-aloud script.
// Pure functions of their inputs (no DOM access), so they run under Node tests.

import { html, labelize, money, hours, raw } from "./ui.js";

const PROFESSIONAL_LABELS = {
  electrician: "licensed electrician",
  gas_technician: "licensed gas technician",
  structural_engineer: "structural engineer",
  roofer: "roofer",
  plumber: "plumber",
  hvac: "HVAC technician",
  water_mitigation: "water-damage mitigation company",
  mold_remediation: "mold remediation specialist",
  general_contractor: "general contractor",
  foundation_specialist: "foundation specialist",
  other: "qualified professional",
};

export function professionalLabel(type) {
  return PROFESSIONAL_LABELS[type] ?? "qualified professional";
}

const asList = (value) => (Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== "") : value ? [value] : []);

/**
 * Normalizes any stored diagnosis — contract v5, v4, or the pre-v4 web schema
 * kept in old browser history — into one display shape with every field present.
 */
export function displayDiagnosis(raw) {
  const d = raw ?? {};
  const isLegacyWeb = !("likely_cause" in d) && !("safe_to_diy" in d) && ("likely_diagnosis" in d || "diy_or_pro" in d);
  if (isLegacyWeb) {
    const pro = d.diy_or_pro === "pro_required" || d.diy_or_pro === "pro_recommended";
    return {
      subject: d.subject ?? "",
      diagnosis: d.likely_diagnosis ?? "Photo assessment",
      observations: [],
      likely_cause: d.probable_cause ?? "",
      possible_causes: [],
      limitations: [],
      severity: Math.max(0, Math.min(10, Number(d.severity_score) || 0)),
      urgency: String(d.severity_label ?? "").toLowerCase().includes("urgent") ? "urgent" : "monitor",
      confidence: null,
      confidenceText: d.confidence ? String(d.confidence) : "Unknown",
      safe_to_diy: d.diy_or_pro === "diy" || d.diy_or_pro === "diy_with_care",
      diy_or_pro_reason: "",
      recommendation: {
        best_fix: d.recommended_repair ?? "",
        cheap_or_temp_fix: d.cheapest_safe_fix ?? d.temporary_fix ?? "",
        tools_or_parts: asList(d.tools_and_parts),
        difficulty: pro ? "pro-only" : "moderate",
        repair_steps: [],
      },
      next_inspection_steps: [],
      cost_estimate: null,
      legacy_cost_text: d.estimated_cost_range ?? null,
      labor_estimate: null,
      risk_if_ignored: d.risk_if_ignored ?? "",
      needs_professional: pro,
      professional_type: null,
      safety_warnings: asList(d.safety_warnings),
      maintenance_tips: [],
      follow_up: null,
      additional_photos: [],
      next_measurement: null,
      legacy: true,
    };
  }
  const recommendation = d.recommendation ?? {};
  const confidence = Number.isFinite(Number(d.confidence)) ? Math.max(0, Math.min(1, Number(d.confidence))) : null;
  return {
    subject: d.subject ?? "",
    diagnosis: d.diagnosis ?? "Photo assessment",
    observations: asList(d.observations),
    likely_cause: d.likely_cause ?? "",
    possible_causes: asList(d.possible_causes),
    limitations: asList(d.limitations),
    severity: Math.max(0, Math.min(10, Number(d.severity) || 0)),
    urgency: d.urgency ?? "monitor",
    confidence,
    confidenceText: confidence === null ? "Unknown" : `${Math.round(confidence * 100)}%`,
    safe_to_diy: Boolean(d.safe_to_diy),
    diy_or_pro_reason: d.diy_or_pro_reason ?? "",
    recommendation: {
      best_fix: recommendation.best_fix ?? "",
      cheap_or_temp_fix: recommendation.cheap_or_temp_fix ?? "",
      tools_or_parts: asList(recommendation.tools_or_parts),
      difficulty: recommendation.difficulty ?? "moderate",
      repair_steps: asList(recommendation.repair_steps),
    },
    next_inspection_steps: asList(d.next_inspection_steps),
    cost_estimate: d.cost_estimate ?? null,
    legacy_cost_text: null,
    labor_estimate: d.labor_estimate ?? null,
    risk_if_ignored: d.risk_if_ignored ?? "",
    needs_professional: Boolean(d.needs_professional),
    professional_type: d.professional_type ?? null,
    safety_warnings: asList(d.safety_warnings),
    maintenance_tips: asList(d.maintenance_tips),
    follow_up: d.follow_up ?? null,
    additional_photos: asList(d.additional_photos),
    next_measurement: d.next_measurement ?? null,
    legacy: false,
  };
}

export const URGENCY_LABELS = { cosmetic: "Cosmetic", monitor: "Monitor", soon: "Fix soon", urgent: "Urgent" };
export const DIFFICULTY_LABELS = { easy: "Easy DIY", moderate: "Moderate DIY", hard: "Hard DIY", "pro-only": "Professional only" };
const LIKELIHOOD_LABELS = { most_likely: "Most likely", possible: "Possible", less_likely: "Less likely" };

export function severityTone(score) {
  if (score <= 2) return "ok";
  if (score <= 4) return "low";
  if (score <= 6) return "mid";
  if (score <= 8) return "high";
  return "critical";
}

export function inspectionTitle(inspection) {
  if (inspection.title) return inspection.title;
  const analysis = inspection.analysis;
  if (analysis?.diagnosis) return displayDiagnosis(analysis.diagnosis).diagnosis;
  if (inspection.status === "awaiting_answers") return "Waiting for your answers";
  if (inspection.status === "retake") return "Photo retake requested";
  if (inspection.status === "cannot_assess") return "Unable to assess";
  if (inspection.status === "draft") return inspection.description ? `Draft: ${inspection.description.slice(0, 60)}` : "Draft inspection";
  return "Inspection";
}

function card(label, body, { id, className = "" } = {}) {
  return html`<section class="info-card ${className}" ${id ? raw(`id="${id}"`) : ""}>
    <h3 class="info-label">${label}</h3>
    <div class="info-body">${body}</div>
  </section>`;
}

function bulletList(items) {
  return html`<ul class="bullets">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

function checklist(kind, items, checked = {}) {
  return html`<ul class="checklist" data-kind="${kind}">${items.map((item, index) => html`
    <li><label class="check">
      <input type="checkbox" data-check="${kind}" data-index="${index}" ${checked[index] ? raw("checked") : ""} />
      <span>${kind === "steps" ? html`<strong class="step-num">${index + 1}.</strong> ` : ""}${item}</span>
    </label></li>`)}</ul>`;
}

export function renderSafetyNotices(analysis) {
  const notices = asList(analysis?.safety_notices);
  if (!notices.length) return "";
  return html`<section class="alert alert-danger" role="alert">
    <h3 class="alert-title">Safety first</h3>
    ${bulletList(notices)}
  </section>`;
}

/** The result body for a diagnosis. `checklistState` holds ticked steps/materials. */
export function renderDiagnosis(analysis, { checklistState = {} } = {}) {
  const d = displayDiagnosis(analysis.diagnosis);
  const tone = severityTone(d.severity);
  const pro = d.needs_professional || !d.safe_to_diy;
  const diyBadge = pro
    ? html`<span class="badge badge-danger">Call a ${professionalLabel(d.professional_type)}</span>`
    : html`<span class="badge badge-ok">Safe to DIY with care</span>`;
  const cost = d.cost_estimate;
  const diyCost = money(cost?.diy_materials);
  const proCost = money(cost?.professional_total);
  const labor = d.labor_estimate;

  return html`
    ${renderSafetyNotices(analysis)}
    <section class="diag-head">
      <h2 class="diag-title">${d.diagnosis}</h2>
      ${d.subject ? html`<p class="muted">${d.subject}</p>` : ""}
      <div class="badges">
        ${diyBadge}
        <span class="badge">${URGENCY_LABELS[d.urgency] ?? labelize(d.urgency)}</span>
        <span class="badge">${DIFFICULTY_LABELS[d.recommendation.difficulty] ?? labelize(d.recommendation.difficulty)}</span>
        <span class="badge" title="How sure FixSight is about this first-look assessment">Confidence ${d.confidenceText}</span>
        ${analysis.image_quality ? html`<span class="badge">Photo ${labelize(analysis.image_quality)}</span>` : ""}
      </div>
      <div class="severity" data-tone="${tone}">
        <div class="severity-top"><span>Severity</span><span class="severity-score">${d.severity}/10</span></div>
        <div class="severity-track" role="meter" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${d.severity}" aria-label="Severity ${d.severity} out of 10">
          <div class="severity-fill" style="width:${d.severity * 10}%"></div>
        </div>
      </div>
    </section>
    ${d.safety_warnings.length ? html`<section class="alert alert-danger"><h3 class="alert-title">Safety warnings</h3>${bulletList(d.safety_warnings)}</section>` : ""}
    ${pro ? html`<section class="alert alert-warn"><h3 class="alert-title">Professional help recommended</h3>
      <p>${d.safe_to_diy ? `Contact a ${professionalLabel(d.professional_type)} before making the full repair.` : `Don't attempt this repair yourself. Contact a ${professionalLabel(d.professional_type)}.`}</p>
      ${d.diy_or_pro_reason ? html`<p class="muted small">${d.diy_or_pro_reason}</p>` : ""}</section>`
      : d.diy_or_pro_reason ? card("Why this is DIY-friendly", d.diy_or_pro_reason) : ""}
    ${analysis.note ? card("Summary", analysis.note) : ""}
    ${d.observations.length ? card("What the photos show", bulletList(d.observations)) : ""}
    ${d.possible_causes.length
      ? card("Possible causes (not confirmed)", html`<ul class="causes">${d.possible_causes.map((cause) => html`
          <li><span class="likelihood" data-l="${cause.likelihood}">${LIKELIHOOD_LABELS[cause.likelihood] ?? labelize(cause.likelihood)}</span>
          <strong>${cause.cause}</strong><span class="muted small"> — ${cause.supporting_evidence}</span></li>`)}</ul>`)
      : d.likely_cause ? card("Likely cause", d.likely_cause) : ""}
    ${d.limitations.length ? card("What a photo can't tell us", bulletList(d.limitations), { className: "card-quiet" }) : ""}
    ${d.recommendation.best_fix ? card("Recommended repair", d.recommendation.best_fix) : ""}
    ${d.recommendation.cheap_or_temp_fix ? card("Safe temporary option", d.recommendation.cheap_or_temp_fix) : ""}
    ${d.recommendation.repair_steps.length
      ? card(html`Step-by-step repair <button type="button" class="link-btn" data-action="step-mode">Hands-free mode</button>`,
          checklist("steps", d.recommendation.repair_steps, checklistState.steps), { id: "repair-steps" })
      : ""}
    ${d.recommendation.tools_or_parts.length ? card("Tools & materials checklist", checklist("materials", d.recommendation.tools_or_parts, checklistState.materials)) : ""}
    ${d.next_inspection_steps.length ? card("Next things to check", bulletList(d.next_inspection_steps)) : ""}
    ${d.next_measurement ? card("Measurement that would settle it", html`
        <p><strong>${labelize(d.next_measurement.instrument)}</strong> — ${d.next_measurement.target}</p>
        <p>${d.next_measurement.why}</p>
        <p class="muted">${d.next_measurement.expected_discriminator}</p>
        ${d.next_measurement.safety_note ? html`<p class="small"><strong>Safety:</strong> ${d.next_measurement.safety_note}</p>` : ""}`) : ""}
    ${cost && (diyCost || proCost || labor)
      ? card("Estimated cost & labor", html`
          <dl class="estimates">
            ${diyCost ? html`<div><dt>DIY materials</dt><dd class="cost">${diyCost}</dd></div>` : ""}
            ${proCost ? html`<div><dt>Professional (typical)</dt><dd class="cost">${proCost}</dd></div>` : ""}
            ${labor ? html`<div><dt>Hands-on time</dt><dd class="cost">${hours(labor.hours_low, labor.hours_high)}</dd><dd class="muted small">${labor.who}</dd></div>` : ""}
          </dl>
          <p class="small muted">Planning ranges, not a quote. Assumptions:</p>
          ${bulletList([...asList(cost.assumptions), ...asList(labor?.assumptions)])}`)
      : cost ? card("Estimated cost", html`<p class="muted">${asList(cost.assumptions).join(" ")}</p>`)
      : d.legacy_cost_text ? card("Estimated cost", html`<span class="cost">${d.legacy_cost_text}</span>`) : ""}
    ${d.risk_if_ignored ? card("If you ignore it", d.risk_if_ignored) : ""}
    ${d.maintenance_tips.length ? card("Prevent it next time", bulletList(d.maintenance_tips)) : ""}
    ${d.follow_up ? card("Follow-up check", html`<p>Look again in <strong>${d.follow_up.reinspect_in_days} days</strong>: ${d.follow_up.what_to_check}</p>`) : ""}
    ${d.additional_photos.length ? card("Photos that would help", html`${bulletList(d.additional_photos)}<button type="button" class="btn btn-secondary btn-small" data-action="add-photos-rerun">Add photos &amp; re-check</button>`) : ""}
    <p class="disclaimer-inline">Photo-based first opinion, not an on-site inspection. Confirm electrical, gas, structural, and other safety-critical work with a licensed professional.</p>`;
}

export function renderNonDiagnosis(analysis) {
  const isRetake = analysis.result_type === "retake";
  const guidance = asList(analysis.retake_guidance);
  return html`
    ${renderSafetyNotices(analysis)}
    <section class="diag-head">
      <h2 class="diag-title">${isRetake ? "Let's retake the photo" : "FixSight can't assess this one"}</h2>
      ${analysis.image_quality ? html`<div class="badges"><span class="badge">Photo ${labelize(analysis.image_quality)}</span></div>` : ""}
    </section>
    ${analysis.note ? html`<div class="note-card">${analysis.note}</div>` : ""}
    ${guidance.length ? card(isRetake ? "How to retake it" : "What may help", bulletList(guidance)) : ""}
    ${!isRetake ? html`<section class="alert alert-warn"><p><strong>Don't guess on safety-critical repairs.</strong> If this could involve electrical, gas, fire, structural, or active water hazards, contact a qualified professional.</p></section>` : ""}`;
}

// ---------- plain-text outputs ----------

export function buildShareText(inspection, { customer = null, job = null } = {}) {
  const analysis = inspection.analysis;
  const lines = ["FixSight inspection summary"];
  if (inspection.createdAt) lines.push(`Date: ${new Date(inspection.createdAt).toLocaleString()}`);
  if (customer) lines.push(`Customer: ${customer.name}`);
  if (job) lines.push(`Job: ${job.title}${job.address ? ` — ${job.address}` : ""}`);
  for (const notice of asList(analysis?.safety_notices)) lines.push(`SAFETY: ${notice}`);
  if (!analysis?.diagnosis) {
    if (analysis?.note) lines.push(analysis.note);
    return lines.join("\n");
  }
  const d = displayDiagnosis(analysis.diagnosis);
  lines.push(`Finding: ${d.diagnosis}`);
  if (d.subject) lines.push(`Subject: ${d.subject}`);
  lines.push(`Severity: ${d.severity}/10 (${URGENCY_LABELS[d.urgency] ?? d.urgency}) · Confidence: ${d.confidenceText}`);
  if (d.observations.length) lines.push("Observed:", ...d.observations.map((item) => `- ${item}`));
  if (d.possible_causes.length) {
    lines.push("Possible causes (not confirmed):", ...d.possible_causes.map((c) => `- ${c.cause} (${LIKELIHOOD_LABELS[c.likelihood] ?? c.likelihood})`));
  } else if (d.likely_cause) lines.push(`Likely cause: ${d.likely_cause}`);
  for (const warning of d.safety_warnings) lines.push(`Safety: ${warning}`);
  lines.push(d.needs_professional || !d.safe_to_diy ? `Professional: contact a ${professionalLabel(d.professional_type)}.` : "DIY: suitable for careful DIY.");
  if (d.recommendation.best_fix) lines.push(`Recommended repair: ${d.recommendation.best_fix}`);
  if (d.recommendation.cheap_or_temp_fix) lines.push(`Temporary option: ${d.recommendation.cheap_or_temp_fix}`);
  if (d.recommendation.repair_steps.length) lines.push("Steps:", ...d.recommendation.repair_steps.map((s, i) => `${i + 1}. ${s}`));
  if (d.recommendation.tools_or_parts.length) lines.push(`Tools & materials: ${d.recommendation.tools_or_parts.join(", ")}`);
  const cost = d.cost_estimate;
  if (cost?.diy_materials) lines.push(`DIY materials: ${money(cost.diy_materials)}`);
  if (cost?.professional_total) lines.push(`Professional estimate: ${money(cost.professional_total)}`);
  if (d.labor_estimate) lines.push(`Labor: ${hours(d.labor_estimate.hours_low, d.labor_estimate.hours_high)} (${d.labor_estimate.who})`);
  if (cost && (cost.diy_materials || cost.professional_total)) lines.push(`Estimates are planning ranges, not quotes. ${asList(cost.assumptions).join(" ")}`);
  if (d.risk_if_ignored) lines.push(`If ignored: ${d.risk_if_ignored}`);
  lines.push("Photo-based first opinion only; confirm safety-critical work with an on-site professional.");
  return lines.join("\n");
}

/** A spoken version: shorter, no symbols, safety first. */
export function buildSpeechText(analysis) {
  const parts = [];
  for (const notice of asList(analysis?.safety_notices)) parts.push(`Safety first. ${notice}`);
  if (!analysis?.diagnosis) {
    if (analysis?.note) parts.push(analysis.note);
    for (const item of asList(analysis?.retake_guidance)) parts.push(item);
    return parts.join(" ");
  }
  const d = displayDiagnosis(analysis.diagnosis);
  parts.push(`${d.diagnosis}.`);
  parts.push(`Severity ${d.severity} out of 10, ${URGENCY_LABELS[d.urgency] ?? d.urgency}.`);
  for (const warning of d.safety_warnings) parts.push(`Warning: ${warning}`);
  if (d.needs_professional || !d.safe_to_diy) parts.push(`FixSight recommends contacting a ${professionalLabel(d.professional_type)}.`);
  if (d.likely_cause) parts.push(`Likely cause: ${d.likely_cause}`);
  if (d.recommendation.best_fix) parts.push(`Recommended repair: ${d.recommendation.best_fix}`);
  if (d.recommendation.cheap_or_temp_fix) parts.push(`In the meantime: ${d.recommendation.cheap_or_temp_fix}`);
  parts.push("This is a photo-based first opinion, not an on-site inspection.");
  return parts.join(" ").replace(/[–—]/g, ", ").replace(/\s+/g, " ").trim();
}
