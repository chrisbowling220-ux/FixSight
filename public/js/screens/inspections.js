// History: every inspection on this device, searchable and filterable.

import * as db from "../db.js";
import { displayDiagnosis, inspectionTitle, severityTone } from "../analysis-view.js";
import { $, formatDate, html, isDue, setHtml } from "../ui.js";

const FILTERS = {
  all: "All",
  open: "Open",
  due: "Follow-up due",
  draft: "Drafts",
  resolved: "Resolved",
};

/** Text that a search should match for one inspection. Exported for tests. */
export function searchText(inspection, { job, customer } = {}) {
  const d = inspection.analysis?.diagnosis ? displayDiagnosis(inspection.analysis.diagnosis) : null;
  return [
    inspectionTitle(inspection),
    inspection.category,
    inspection.description,
    d?.subject,
    d?.likely_cause,
    job?.title,
    job?.address,
    customer?.name,
    ...(inspection.notes ?? []).map((note) => note.text),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchesFilter(inspection, filter, now = new Date()) {
  if (filter === "open") return !inspection.resolved && inspection.status !== "draft";
  if (filter === "due") return !inspection.resolved && isDue(inspection.followUpDue, now);
  if (filter === "draft") return inspection.status === "draft";
  if (filter === "resolved") return Boolean(inspection.resolved);
  return true;
}

export async function render(view, query, ctx) {
  const [inspections, jobs, customers] = await Promise.all([db.listInspections(), db.listJobs(), db.listCustomers()]);
  const jobById = Object.fromEntries(jobs.map((job) => [job.id, job]));
  const customerById = Object.fromEntries(customers.map((customer) => [customer.id, customer]));
  let filter = FILTERS[query.get("filter")] ? query.get("filter") : "all";
  let term = query.get("q") ?? "";

  setHtml(view, html`
    <h1 class="screen-title">History</h1>
    <div class="search-row">
      <input type="search" id="search" placeholder="Search findings, customers, notes…" value="${term}" aria-label="Search inspections" />
    </div>
    <div class="chips" role="group" aria-label="Filter">
      ${Object.entries(FILTERS).map(([key, label]) => html`<button type="button" class="chip ${key === filter ? "selected" : ""}" data-filter="${key}" aria-pressed="${key === filter}">${label}</button>`)}
    </div>
    <p class="muted small">${inspections.length} inspection${inspections.length === 1 ? "" : "s"} saved on this device.</p>
    <div id="results" class="card-list"></div>`);

  function draw() {
    const needle = term.trim().toLowerCase();
    const shown = inspections.filter((inspection) => {
      if (!matchesFilter(inspection, filter)) return false;
      if (!needle) return true;
      const job = jobById[inspection.jobId];
      return searchText(inspection, { job, customer: customerById[job?.customerId] }).includes(needle);
    });
    if (!inspections.length) {
      setHtml($("#results", view), html`<div class="empty"><p class="empty-title">No inspections yet</p><p class="muted">Take photos of a problem on the Inspect tab to get started.</p><a class="btn btn-accent" href="#/scan">Start an inspection</a></div>`);
      return;
    }
    if (!shown.length) {
      setHtml($("#results", view), html`<p class="empty muted">No inspections match.</p>`);
      return;
    }
    setHtml($("#results", view), shown.map((inspection) => {
      const d = inspection.analysis?.diagnosis ? displayDiagnosis(inspection.analysis.diagnosis) : null;
      const job = jobById[inspection.jobId];
      const customer = customerById[job?.customerId];
      const photo = inspection.photos?.[0];
      return html`<a class="list-card" href="#/inspection/${inspection.id}">
        ${photo ? html`<img src="${photo.thumb || photo.dataUrl}" alt="" />` : html`<div class="list-card-ph" aria-hidden="true">📷</div>`}
        <div class="list-card-body">
          <p class="list-card-title">${inspectionTitle(inspection)}</p>
          <p class="list-card-meta">${formatDate(inspection.createdAt)}${inspection.category ? ` · ${inspection.category}` : ""}${job ? ` · ${job.title}` : ""}${customer ? ` · ${customer.name}` : ""}</p>
          <p class="list-card-tags">
            ${d ? html`<span class="severity-chip" data-tone="${severityTone(d.severity)}">${d.severity}/10</span>` : ""}
            ${inspection.status === "draft" ? html`<span class="tag">Draft</span>` : ""}
            ${inspection.status === "awaiting_answers" ? html`<span class="tag">Needs answers</span>` : ""}
            ${inspection.resolved ? html`<span class="tag tag-ok">Resolved</span>` : ""}
            ${!inspection.resolved && isDue(inspection.followUpDue) ? html`<span class="tag tag-warn">Follow-up due</span>` : ""}
            ${inspection.parentId ? html`<span class="tag">Follow-up</span>` : ""}
          </p>
        </div>
      </a>`;
    }));
  }

  $("#search", view).addEventListener("input", (event) => {
    term = event.target.value;
    draw();
  });
  view.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    filter = chip.dataset.filter;
    view.querySelectorAll("[data-filter]").forEach((element) => {
      element.classList.toggle("selected", element.dataset.filter === filter);
      element.setAttribute("aria-pressed", String(element.dataset.filter === filter));
    });
    draw();
  });
  draw();
  void ctx;
}
