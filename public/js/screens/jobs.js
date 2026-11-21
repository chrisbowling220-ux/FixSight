// Customers and jobs: who the work is for, where, its status, and its inspections.

import * as db from "../db.js";
import { displayDiagnosis, inspectionTitle, severityTone } from "../analysis-view.js";
import { buildPdf } from "../report.js";
import { $, confirmDialog, downloadBlob, formatDate, formatDateTime, html, raw, setHtml, slugify, toast, uid } from "../ui.js";

export const JOB_STATUSES = {
  new: "New",
  scheduled: "Scheduled",
  in_progress: "In progress",
  waiting: "Waiting on parts/customer",
  completed: "Completed",
  cancelled: "Cancelled",
};

function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// ---------- lists ----------

export async function renderList(view, query, ctx) {
  const tab = query.get("tab") === "customers" ? "customers" : "jobs";
  const [jobs, customers, inspections] = await Promise.all([db.listJobs(), db.listCustomers(), db.listInspections()]);
  const customerById = Object.fromEntries(customers.map((customer) => [customer.id, customer]));
  const countByJob = {};
  for (const inspection of inspections) if (inspection.jobId) countByJob[inspection.jobId] = (countByJob[inspection.jobId] ?? 0) + 1;
  let term = "";
  let status = "active";

  setHtml(view, html`
    <h1 class="screen-title">Jobs &amp; customers</h1>
    <div class="tabs" role="tablist">
      <a role="tab" href="#/jobs" class="tab ${tab === "jobs" ? "active" : ""}" aria-selected="${tab === "jobs"}">Jobs (${jobs.length})</a>
      <a role="tab" href="#/jobs?tab=customers" class="tab ${tab === "customers" ? "active" : ""}" aria-selected="${tab === "customers"}">Customers (${customers.length})</a>
    </div>
    <div class="search-row">
      <input type="search" id="search" placeholder="${tab === "jobs" ? "Search jobs, addresses, customers…" : "Search customers…"}" aria-label="Search" />
      <a class="btn btn-accent" href="${tab === "jobs" ? "#/job/new" : "#/customer/new"}">+ New ${tab === "jobs" ? "job" : "customer"}</a>
    </div>
    ${tab === "jobs" ? html`<div class="chips" role="group" aria-label="Job status filter">
      ${[["active", "Active"], ["all", "All"], ...Object.entries(JOB_STATUSES)].map(([key, label]) => html`<button type="button" class="chip ${key === status ? "selected" : ""}" data-status="${key}" aria-pressed="${key === status}">${label}</button>`)}
    </div>` : ""}
    <div id="results" class="card-list"></div>
    <p class="muted small">Customer and job records are stored only on this device. Export a backup from Settings.</p>`);

  function draw() {
    const needle = term.trim().toLowerCase();
    const results = $("#results", view);
    if (tab === "customers") {
      const shown = customers.filter((customer) => !needle || [customer.name, customer.phone, customer.email, customer.address, customer.notes].filter(Boolean).join(" ").toLowerCase().includes(needle));
      setHtml(results, shown.length ? shown.map((customer) => html`<a class="list-card list-card-plain" href="#/customer/${customer.id}">
          <div class="list-card-body"><p class="list-card-title">${customer.name}</p>
          <p class="list-card-meta">${[customer.phone, customer.email, customer.address].filter(Boolean).join(" · ")}</p>
          <p class="list-card-meta">${jobs.filter((job) => job.customerId === customer.id).length} job(s)</p></div></a>`)
        : html`<div class="empty"><p class="muted">${customers.length ? "No customers match." : "No customers yet."}</p></div>`);
      return;
    }
    const shown = jobs.filter((job) => {
      if (status === "active" && (job.status === "completed" || job.status === "cancelled")) return false;
      if (status !== "active" && status !== "all" && job.status !== status) return false;
      if (!needle) return true;
      return [job.title, job.address, job.notes, customerById[job.customerId]?.name].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
    setHtml(results, shown.length ? shown.map((job) => html`<a class="list-card list-card-plain" href="#/job/${job.id}">
        <div class="list-card-body"><p class="list-card-title">${job.title}</p>
        <p class="list-card-meta">${[customerById[job.customerId]?.name, job.address].filter(Boolean).join(" · ")}</p>
        <p class="list-card-tags"><span class="tag" data-job-status="${job.status}">${JOB_STATUSES[job.status] ?? job.status}</span>
        <span class="muted small">${countByJob[job.id] ?? 0} inspection(s) · updated ${formatDate(job.updatedAt)}</span></p></div></a>`)
      : html`<div class="empty"><p class="muted">${jobs.length ? "No jobs match." : "No jobs yet. Create one to group inspections for a customer or property."}</p></div>`);
  }

  $("#search", view).addEventListener("input", (event) => {
    term = event.target.value;
    draw();
  });
  view.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status]");
    if (!chip || !chip.classList.contains("chip")) return;
    status = chip.dataset.status;
    view.querySelectorAll(".chip[data-status]").forEach((element) => {
      element.classList.toggle("selected", element.dataset.status === status);
      element.setAttribute("aria-pressed", String(element.dataset.status === status));
    });
    draw();
  });
  draw();
  void ctx;
}

// ---------- customer ----------

function customerForm(customer = {}) {
  return html`
    <form id="customer-form" class="form panel">
      <label>Name <span class="req">*</span><input type="text" name="name" required maxlength="120" value="${customer.name ?? ""}" autocomplete="name" /></label>
      <label>Phone<input type="tel" name="phone" maxlength="40" value="${customer.phone ?? ""}" autocomplete="tel" /></label>
      <label>Email<input type="email" name="email" maxlength="120" value="${customer.email ?? ""}" autocomplete="email" /></label>
      <label>Address<input type="text" name="address" maxlength="200" value="${customer.address ?? ""}" autocomplete="street-address" /></label>
      <label>Notes<textarea name="notes" rows="3" maxlength="2000">${customer.notes ?? ""}</textarea></label>
      <div class="btn-row"><button type="submit" class="btn btn-accent">Save customer</button></div>
    </form>`;
}

function readForm(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()]));
}

export async function renderCustomer(view, id, ctx) {
  const isNew = id === "new";
  const customer = isNew ? null : await db.get("customers", id);
  if (!isNew && !customer) throw new Error("Customer not found.");
  const jobs = isNew ? [] : (await db.byIndex("jobs", "customerId", id)).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  setHtml(view, html`
    <div class="detail-head"><a href="#/jobs?tab=customers" class="back-link">‹ Customers</a></div>
    <h1 class="screen-title">${isNew ? "New customer" : customer.name}</h1>
    ${!isNew ? html`<div class="btn-row contact-row">
      ${customer.phone ? html`<a class="btn btn-secondary" href="tel:${customer.phone}">📞 Call</a><a class="btn btn-secondary" href="sms:${customer.phone}">💬 Text</a>` : ""}
      ${customer.email ? html`<a class="btn btn-secondary" href="mailto:${customer.email}">✉️ Email</a>` : ""}
      ${customer.address ? html`<a class="btn btn-secondary" href="${mapsLink(customer.address)}" target="_blank" rel="noopener noreferrer">📍 Map</a>` : ""}
    </div>` : ""}
    <div class="detail-grid">
      <div class="detail-main">${customerForm(customer ?? {})}</div>
      ${!isNew ? html`<aside class="detail-side">
        <section class="panel"><h2 class="panel-title">Jobs</h2>
          <ul class="link-list">${jobs.map((job) => html`<li><a href="#/job/${job.id}">${job.title}</a> <span class="tag" data-job-status="${job.status}">${JOB_STATUSES[job.status]}</span></li>`)}</ul>
          <a class="btn btn-secondary" href="#/job/new?customer=${customer.id}">+ New job for ${customer.name}</a>
        </section>
        <button type="button" class="btn btn-danger-ghost" id="delete-customer">Delete customer</button>
      </aside>` : ""}
    </div>`);

  $("#customer-form", view).addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.target);
    if (!values.name) return;
    const saved = await db.put("customers", { ...(customer ?? { id: uid("cust"), createdAt: new Date().toISOString() }), ...values });
    toast("Customer saved.");
    ctx.navigate(`/customer/${saved.id}`);
  });
  $("#delete-customer", view)?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Delete ${customer.name}? Their jobs and inspections are kept but unlinked.`, { confirmLabel: "Delete", danger: true }))) return;
    await db.deleteCustomer(customer.id);
    toast("Customer deleted.");
    ctx.navigate("/jobs?tab=customers");
  });
}

// ---------- job ----------

function jobForm(job, customers, preset = {}) {
  const customerId = job.customerId ?? preset.customerId ?? "";
  return html`
    <form id="job-form" class="form panel">
      <label>Job title <span class="req">*</span><input type="text" name="title" required maxlength="120" placeholder="e.g. Kitchen ceiling leak" value="${job.title ?? ""}" /></label>
      <label>Customer
        <select name="customerId"><option value="">No customer</option>
          ${customers.map((customer) => html`<option value="${customer.id}" ${customer.id === customerId ? raw("selected") : ""}>${customer.name}</option>`)}
          <option value="__new">+ Add a new customer…</option></select></label>
      <div class="new-customer" hidden>
        <label>New customer name<input type="text" name="newCustomerName" maxlength="120" /></label>
        <label>Phone<input type="tel" name="newCustomerPhone" maxlength="40" /></label>
      </div>
      <label>Property address<input type="text" name="address" maxlength="200" value="${job.address ?? preset.address ?? ""}" autocomplete="street-address" /></label>
      <label>Status
        <select name="status">${Object.entries(JOB_STATUSES).map(([key, label]) => html`<option value="${key}" ${key === (job.status ?? "new") ? raw("selected") : ""}>${label}</option>`)}</select></label>
      <label>Scheduled date<input type="date" name="scheduledFor" value="${job.scheduledFor ?? ""}" /></label>
      <label>Notes<textarea name="notes" rows="3" maxlength="4000">${job.notes ?? ""}</textarea></label>
      <div class="btn-row"><button type="submit" class="btn btn-accent">Save job</button></div>
    </form>`;
}

export async function renderJob(view, id, query, ctx) {
  const isNew = id === "new";
  const job = isNew ? null : await db.get("jobs", id);
  if (!isNew && !job) throw new Error("Job not found.");
  const customers = await db.listCustomers();
  const presetCustomer = query.get("customer");
  const presetAddress = presetCustomer ? customers.find((customer) => customer.id === presetCustomer)?.address : "";
  const linkInspection = query.get("inspection");
  const customer = job?.customerId ? customers.find((item) => item.id === job.customerId) : null;
  const inspections = isNew ? [] : (await db.byIndex("inspections", "jobId", id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  setHtml(view, html`
    <div class="detail-head"><a href="#/jobs" class="back-link">‹ Jobs</a>
      ${!isNew ? html`<span class="tag" data-job-status="${job.status}">${JOB_STATUSES[job.status]}</span>` : ""}</div>
    <h1 class="screen-title">${isNew ? "New job" : job.title}</h1>
    ${!isNew ? html`<p class="muted small">${customer ? html`<a href="#/customer/${customer.id}">${customer.name}</a>` : "No customer"}${job.address ? html` · <a href="${mapsLink(job.address)}" target="_blank" rel="noopener noreferrer">${job.address}</a>` : ""}${job.scheduledFor ? ` · Scheduled ${formatDate(job.scheduledFor)}` : ""}</p>` : ""}
    <div class="detail-grid">
      <div class="detail-main">
        ${!isNew ? html`<section class="panel">
          <div class="panel-head"><h2 class="panel-title">Inspections (${inspections.length})</h2>
            <a class="btn btn-accent btn-small" href="#/scan?job=${job.id}">+ New inspection</a></div>
          ${inspections.length ? html`<div class="card-list">${inspections.map((inspection) => {
            const d = inspection.analysis?.diagnosis ? displayDiagnosis(inspection.analysis.diagnosis) : null;
            const photo = inspection.photos?.[0];
            return html`<a class="list-card" href="#/inspection/${inspection.id}">
              ${photo ? html`<img src="${photo.thumb || photo.dataUrl}" alt="" />` : html`<div class="list-card-ph" aria-hidden="true">📷</div>`}
              <div class="list-card-body"><p class="list-card-title">${inspectionTitle(inspection)}</p>
              <p class="list-card-meta">${formatDate(inspection.createdAt)}${inspection.parentId ? " · follow-up" : ""}</p>
              <p class="list-card-tags">${d ? html`<span class="severity-chip" data-tone="${severityTone(d.severity)}">${d.severity}/10</span>` : ""}
              ${inspection.resolved ? html`<span class="tag tag-ok">Resolved</span>` : ""}
              ${(inspection.progressPhotos ?? []).length ? html`<span class="tag">${inspection.progressPhotos.length} progress photo(s)</span>` : ""}</p></div></a>`;
          })}</div>
          <button type="button" class="btn btn-primary" id="job-pdf">Download job report (PDF)</button>` : html`<p class="muted">No inspections yet.</p>`}
        </section>
        <section class="panel">
          <h2 class="panel-title">Progress log</h2>
          <ul class="notes">${[...(job.log ?? [])].reverse().map((entry) => html`<li><span class="muted small">${formatDateTime(entry.at)}</span><br />${entry.text}</li>`)}</ul>
          <div class="inline-fields"><input type="text" id="log-text" maxlength="500" placeholder="e.g. Ordered replacement flashing" aria-label="Log entry" />
          <button type="button" class="btn btn-secondary btn-small" id="add-log">Add</button></div>
        </section>` : ""}
        ${jobForm(job ?? {}, customers, { customerId: presetCustomer, address: presetAddress })}
      </div>
      ${!isNew ? html`<aside class="detail-side"><button type="button" class="btn btn-danger-ghost" id="delete-job">Delete job</button></aside>` : ""}
    </div>`);

  const form = $("#job-form", view);
  const customerSelect = form.querySelector('select[name="customerId"]');
  customerSelect.addEventListener("change", () => {
    form.querySelector(".new-customer").hidden = customerSelect.value !== "__new";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(form);
    if (!values.title) return;
    let customerId = values.customerId || null;
    if (customerId === "__new") {
      if (!values.newCustomerName) {
        toast("Enter the new customer's name.", { tone: "warn" });
        return;
      }
      const created = await db.put("customers", { id: uid("cust"), createdAt: new Date().toISOString(), name: values.newCustomerName, phone: values.newCustomerPhone, email: "", address: values.address, notes: "" });
      customerId = created.id;
    }
    const now = new Date().toISOString();
    const base = job ?? { id: uid("job"), createdAt: now, log: [{ at: now, text: "Job created" }] };
    const statusChanged = job && job.status !== values.status;
    const saved = await db.put("jobs", {
      ...base,
      title: values.title,
      customerId,
      address: values.address,
      status: values.status,
      scheduledFor: values.scheduledFor || null,
      notes: values.notes,
      log: statusChanged ? [...(base.log ?? []), { at: now, text: `Status: ${JOB_STATUSES[values.status]}` }] : base.log ?? [],
    });
    if (linkInspection) {
      const inspection = await db.get("inspections", linkInspection);
      if (inspection) await db.put("inspections", { ...inspection, jobId: saved.id });
    }
    toast("Job saved.");
    ctx.navigate(`/job/${saved.id}`);
  });

  $("#add-log", view)?.addEventListener("click", async () => {
    const text = $("#log-text", view).value.trim();
    if (!text) return;
    await db.put("jobs", { ...job, log: [...(job.log ?? []), { at: new Date().toISOString(), text }] });
    ctx.rerender();
  });

  $("#job-pdf", view)?.addEventListener("click", async () => {
    toast("Preparing job report…", { duration: 10000 });
    try {
      const earlierById = {};
      for (const inspection of inspections) {
        if (inspection.parentId) {
          const parent = await db.get("inspections", inspection.parentId);
          if (parent) earlierById[inspection.id] = parent;
        }
      }
      const blob = await buildPdf({ inspections, job, customer, business: await db.getSetting("business", {}), earlierById });
      downloadBlob(blob, `fixsight-job-${slugify(job.title)}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast("Job report downloaded.");
    } catch (error) {
      toast(error.message || "Couldn't create the report.", { tone: "error" });
    }
  });

  $("#delete-job", view)?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Delete the job "${job.title}"? Its inspections are kept but unlinked.`, { confirmLabel: "Delete", danger: true }))) return;
    await db.deleteJob(job.id);
    toast("Job deleted.");
    ctx.navigate("/jobs");
  });
}
