// Professional PDF reports, generated entirely on the device with jsPDF.
// Photos and customer details never leave the browser to make a report.

import { displayDiagnosis, inspectionTitle, professionalLabel, URGENCY_LABELS, DIFFICULTY_LABELS } from "./analysis-view.js";
import { formatDate, formatDateTime, hours, money } from "./ui.js";

let loader = null;
/** Loads the vendored jsPDF bundle on first use (about 420 KB). */
export function loadJsPdf() {
  if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
  loader ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/jspdf.umd.min.js";
    script.onload = () => (globalThis.jspdf?.jsPDF ? resolve(globalThis.jspdf.jsPDF) : reject(new Error("PDF library failed to load.")));
    script.onerror = () => {
      loader = null;
      reject(new Error("The PDF tool couldn't load. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loader;
}

const REPLACEMENTS = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/[•●▪]/g, "-"],
  [/≈/g, "~"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/[→⇒]/g, "->"],
  [/ /g, " "],
];

/** Maps text to the Latin-1 range the standard PDF fonts can draw. */
export function pdfSafe(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  // Drop emoji and anything else outside Latin-1 rather than print garbage.
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

const COLORS = {
  ink: [23, 32, 37],
  muted: [92, 107, 115],
  brand: [14, 58, 67],
  accent: [232, 132, 44],
  line: [221, 229, 228],
  danger: [180, 40, 40],
  dangerSoft: [253, 234, 234],
  warnSoft: [253, 243, 226],
  soft: [242, 245, 244],
};

const SEVERITY_COLORS = [
  [46, 139, 87], [46, 139, 87], [46, 139, 87],
  [122, 168, 50], [122, 168, 50],
  [217, 161, 26], [217, 161, 26],
  [217, 122, 26], [217, 122, 26],
  [201, 58, 58], [201, 58, 58],
];

class Layout {
  constructor(doc, business) {
    this.doc = doc;
    this.business = business ?? {};
    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
    this.margin = 48;
    this.width = this.pageWidth - this.margin * 2;
    this.bottom = this.pageHeight - 64;
    this.y = this.margin;
  }

  color(rgb, kind = "text") {
    if (kind === "text") this.doc.setTextColor(...rgb);
    else if (kind === "fill") this.doc.setFillColor(...rgb);
    else this.doc.setDrawColor(...rgb);
  }

  ensure(height) {
    if (this.y + height > this.bottom) {
      this.doc.addPage();
      this.y = this.margin;
    }
  }

  text(value, { size = 10.5, bold = false, color = COLORS.ink, indent = 0, gap = 4, width } = {}) {
    const safe = pdfSafe(value);
    if (!safe.trim()) return;
    this.doc.setFont("helvetica", bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.color(color);
    const lines = this.doc.splitTextToSize(safe, (width ?? this.width) - indent);
    const lineHeight = size * 1.35;
    for (const line of lines) {
      this.ensure(lineHeight);
      this.doc.text(line, this.margin + indent, this.y + size);
      this.y += lineHeight;
    }
    this.y += gap;
  }

  heading(value) {
    this.ensure(40);
    this.y += 8;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.color(COLORS.brand);
    this.doc.text(pdfSafe(value).toUpperCase(), this.margin, this.y + 9);
    this.y += 13;
    this.color(COLORS.line, "draw");
    this.doc.setLineWidth(0.6);
    this.doc.line(this.margin, this.y, this.margin + this.width, this.y);
    this.y += 7;
  }

  bullets(items, { checkbox = false, numbered = false } = {}) {
    items.forEach((item, index) => {
      const marker = numbered ? `${index + 1}.` : checkbox ? "" : "-";
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(10.5);
      const lines = this.doc.splitTextToSize(pdfSafe(item), this.width - 18);
      this.ensure(14.2 * Math.min(lines.length, 2));
      if (checkbox) {
        this.color(COLORS.muted, "draw");
        this.doc.setLineWidth(0.8);
        this.doc.rect(this.margin + 2, this.y + 3, 8, 8);
      } else {
        this.color(COLORS.muted);
        this.doc.text(marker, this.margin + 2, this.y + 10.5);
      }
      this.color(COLORS.ink);
      for (const line of lines) {
        this.ensure(14.2);
        this.doc.text(line, this.margin + 18, this.y + 10.5);
        this.y += 14.2;
      }
      this.y += 2;
    });
    this.y += 4;
  }

  box(lines, { fill = COLORS.soft, border = null, title = null, titleColor = COLORS.ink } = {}) {
    this.doc.setFontSize(10.5);
    const wrapped = lines.flatMap((line) => this.doc.splitTextToSize(pdfSafe(line), this.width - 24));
    const height = 16 + (title ? 16 : 0) + wrapped.length * 14.2;
    this.ensure(height + 8);
    this.color(fill, "fill");
    this.doc.roundedRect(this.margin, this.y, this.width, height, 6, 6, "F");
    if (border) {
      this.color(border, "fill");
      this.doc.rect(this.margin, this.y, 4, height, "F");
    }
    let y = this.y + 8;
    if (title) {
      this.doc.setFont("helvetica", "bold");
      this.color(titleColor);
      this.doc.text(pdfSafe(title), this.margin + 14, y + 10);
      y += 16;
    }
    this.doc.setFont("helvetica", "normal");
    this.color(COLORS.ink);
    for (const line of wrapped) {
      this.doc.text(line, this.margin + 14, y + 10.5);
      y += 14.2;
    }
    this.y += height + 8;
  }

  photoGrid(photos, { columns = 2, captionFor = () => "" } = {}) {
    const gap = 12;
    const cellWidth = (this.width - gap * (columns - 1)) / columns;
    const cellHeight = cellWidth * 0.75;
    for (let index = 0; index < photos.length; index += columns) {
      const row = photos.slice(index, index + columns);
      this.ensure(cellHeight + 22);
      row.forEach((photo, column) => {
        const x = this.margin + column * (cellWidth + gap);
        try {
          const props = this.doc.getImageProperties(photo.dataUrl);
          const scale = Math.min(cellWidth / props.width, cellHeight / props.height);
          const w = props.width * scale;
          const h = props.height * scale;
          this.color(COLORS.soft, "fill");
          this.doc.rect(x, this.y, cellWidth, cellHeight, "F");
          this.doc.addImage(photo.dataUrl, "JPEG", x + (cellWidth - w) / 2, this.y + (cellHeight - h) / 2, w, h, undefined, "MEDIUM");
        } catch {
          this.color(COLORS.soft, "fill");
          this.doc.rect(x, this.y, cellWidth, cellHeight, "F");
        }
        const caption = captionFor(photo, index + column);
        if (caption) {
          this.doc.setFont("helvetica", "normal");
          this.doc.setFontSize(8.5);
          this.color(COLORS.muted);
          this.doc.text(pdfSafe(caption), x, this.y + cellHeight + 11, { maxWidth: cellWidth });
        }
      });
      this.y += cellHeight + 22;
    }
  }

  severityBar(score) {
    this.ensure(26);
    const barWidth = 180;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.color(COLORS.ink);
    this.doc.text(`Severity ${score}/10`, this.margin, this.y + 10);
    this.color(COLORS.line, "fill");
    this.doc.roundedRect(this.margin + 90, this.y + 3, barWidth, 8, 4, 4, "F");
    this.color(SEVERITY_COLORS[score] ?? SEVERITY_COLORS[5], "fill");
    if (score > 0) this.doc.roundedRect(this.margin + 90, this.y + 3, Math.max(8, (barWidth * score) / 10), 8, 4, 4, "F");
    this.y += 20;
  }
}

function header(layout, { title, subtitle }) {
  const { doc, business } = layout;
  let textX = layout.margin;
  if (business.logoDataUrl) {
    try {
      const props = doc.getImageProperties(business.logoDataUrl);
      const scale = Math.min(110 / props.width, 48 / props.height);
      doc.addImage(business.logoDataUrl, props.fileType || "PNG", layout.margin, layout.y, props.width * scale, props.height * scale);
      textX = layout.margin + props.width * scale + 12;
    } catch {
      /* skip a logo the PDF library can't read */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  layout.color(COLORS.brand);
  doc.text(pdfSafe(business.name || "FixSight"), textX, layout.y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  layout.color(COLORS.muted);
  const contact = [business.phone, business.email, business.website].filter(Boolean).join("  |  ");
  if (contact) doc.text(pdfSafe(contact), textX, layout.y + 30);
  if (business.license) doc.text(pdfSafe(`License: ${business.license}`), textX, layout.y + 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  layout.color(COLORS.ink);
  doc.text(pdfSafe(title), layout.pageWidth - layout.margin, layout.y + 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  layout.color(COLORS.muted);
  doc.text(pdfSafe(subtitle), layout.pageWidth - layout.margin, layout.y + 30, { align: "right" });
  layout.y += 58;
  layout.color(COLORS.accent, "fill");
  doc.rect(layout.margin, layout.y, layout.width, 2.5, "F");
  layout.y += 16;
}

function footers(layout) {
  const { doc } = layout;
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    layout.color(COLORS.muted);
    const y = layout.pageHeight - 36;
    doc.text(
      pdfSafe("Photo-based first opinion generated with FixSight. Not an on-site inspection or a quote. Confirm electrical, gas, structural and other safety-critical work with a licensed professional."),
      layout.margin, y, { maxWidth: layout.width - 70 },
    );
    doc.text(`Page ${page} of ${total}`, layout.pageWidth - layout.margin, y, { align: "right" });
  }
}

const STAGE_LABELS = { before: "Before", during: "During", after: "After" };
const ROLE_CAPTIONS = { wide: "Wide shot", close_up: "Close-up", detail: "Detail" };

function inspectionSection(layout, inspection, { index, total, earlier }) {
  const analysis = inspection.analysis;
  if (total > 1) {
    layout.ensure(60);
    layout.text(`Inspection ${index + 1} of ${total}: ${inspectionTitle(inspection)}`, { size: 13, bold: true, color: COLORS.brand, gap: 2 });
  } else {
    layout.text(inspectionTitle(inspection), { size: 15, bold: true, gap: 2 });
  }
  layout.text(
    [formatDateTime(inspection.createdAt), inspection.category, inspection.resolved ? "Resolved" : null].filter(Boolean).join("  |  "),
    { size: 9, color: COLORS.muted, gap: 8 },
  );

  for (const notice of analysis?.safety_notices ?? []) {
    layout.box([notice], { fill: COLORS.dangerSoft, border: COLORS.danger, title: "Safety first", titleColor: COLORS.danger });
  }

  if (inspection.photos?.length) {
    layout.photoGrid(inspection.photos, {
      captionFor: (photo, photoIndex) =>
        `Photo ${photoIndex + 1}${photo.role ? ` - ${ROLE_CAPTIONS[photo.role] ?? photo.role}` : ""}${photo.annotated ? " (marked by inspector)" : ""}`,
    });
  }

  if (inspection.description) {
    layout.heading("Reported concern");
    layout.text(inspection.description);
  }

  if (!analysis?.diagnosis) {
    layout.heading("Assessment");
    layout.text(analysis?.note ?? "This inspection has not been analyzed yet.");
    if (analysis?.retake_guidance?.length) layout.bullets(analysis.retake_guidance);
  } else {
    const d = displayDiagnosis(analysis.diagnosis);
    const pro = d.needs_professional || !d.safe_to_diy;
    layout.heading("Finding");
    layout.text(d.diagnosis, { bold: true, size: 12, gap: 2 });
    if (d.subject) layout.text(d.subject, { color: COLORS.muted });
    layout.severityBar(d.severity);
    layout.text(
      [
        `Urgency: ${URGENCY_LABELS[d.urgency] ?? d.urgency}`,
        `Confidence: ${d.confidenceText}`,
        `Handling: ${pro ? `Professional (${professionalLabel(d.professional_type)})` : "Suitable for careful DIY"}`,
        `Difficulty: ${DIFFICULTY_LABELS[d.recommendation.difficulty] ?? d.recommendation.difficulty}`,
      ].join("   |   "),
      { size: 9.5, color: COLORS.muted, gap: 8 },
    );
    if (d.safety_warnings.length) {
      layout.box(d.safety_warnings, { fill: COLORS.dangerSoft, border: COLORS.danger, title: "Safety warnings", titleColor: COLORS.danger });
    }
    if (d.diy_or_pro_reason) layout.text(d.diy_or_pro_reason, { color: COLORS.muted });
    if (d.observations.length) {
      layout.heading("Observed in the photos");
      layout.bullets(d.observations);
    }
    if (d.possible_causes.length) {
      layout.heading("Possible causes (not confirmed)");
      layout.bullets(d.possible_causes.map((c) => `${c.cause} (${c.likelihood.replace(/_/g, " ")}): ${c.supporting_evidence}`));
    } else if (d.likely_cause) {
      layout.heading("Likely cause");
      layout.text(d.likely_cause);
    }
    if (d.limitations.length) {
      layout.heading("Limitations of a photo assessment");
      layout.bullets(d.limitations);
    }
    layout.heading("Recommended repair");
    layout.text(d.recommendation.best_fix);
    if (d.recommendation.cheap_or_temp_fix) {
      layout.text(`Safe temporary option: ${d.recommendation.cheap_or_temp_fix}`, { color: COLORS.muted });
    }
    if (d.recommendation.repair_steps.length) {
      layout.heading("Repair steps");
      layout.bullets(d.recommendation.repair_steps, { numbered: true });
    }
    if (d.recommendation.tools_or_parts.length) {
      layout.heading("Tools & materials");
      layout.bullets(d.recommendation.tools_or_parts, { checkbox: true });
    }
    if (d.next_inspection_steps.length) {
      layout.heading("Recommended next checks");
      layout.bullets(d.next_inspection_steps);
    }
    const cost = d.cost_estimate;
    if (cost && (cost.diy_materials || cost.professional_total || d.labor_estimate)) {
      layout.heading("Estimated cost & labor (planning ranges, not a quote)");
      const rows = [];
      if (cost.diy_materials) rows.push(`DIY materials: ${money(cost.diy_materials)}`);
      if (cost.professional_total) rows.push(`Professional, typical total: ${money(cost.professional_total)}`);
      if (d.labor_estimate) rows.push(`Hands-on labor: ${hours(d.labor_estimate.hours_low, d.labor_estimate.hours_high)} (${d.labor_estimate.who})`);
      layout.box(rows, { fill: COLORS.warnSoft });
      layout.text("Assumptions:", { size: 9, bold: true, color: COLORS.muted, gap: 0 });
      layout.bullets([...(cost.assumptions ?? []), ...(d.labor_estimate?.assumptions ?? [])]);
    }
    if (d.risk_if_ignored) {
      layout.heading("If left unaddressed");
      layout.text(d.risk_if_ignored);
    }
    if (d.maintenance_tips.length) {
      layout.heading("Maintenance recommendations");
      layout.bullets(d.maintenance_tips);
    }
    if (d.follow_up) {
      layout.heading("Follow-up inspection");
      layout.text(`Re-check in ${d.follow_up.reinspect_in_days} days: ${d.follow_up.what_to_check}`);
    }
  }

  if (earlier) {
    layout.heading("Before and after comparison");
    const before = earlier.photos?.[0];
    const after = inspection.photos?.[0];
    if (before && after) {
      layout.photoGrid([before, after], {
        captionFor: (_photo, photoIndex) =>
          photoIndex === 0 ? `Earlier: ${formatDate(earlier.createdAt)}` : `Current: ${formatDate(inspection.createdAt)}`,
      });
    }
    const earlierFinding = earlier.analysis?.diagnosis ? displayDiagnosis(earlier.analysis.diagnosis) : null;
    const currentFinding = analysis?.diagnosis ? displayDiagnosis(analysis.diagnosis) : null;
    if (earlierFinding && currentFinding) {
      layout.text(`Earlier: ${earlierFinding.diagnosis} (severity ${earlierFinding.severity}/10)`, { size: 9.5 });
      layout.text(`Current: ${currentFinding.diagnosis} (severity ${currentFinding.severity}/10)`, { size: 9.5 });
    }
    layout.text("A visual comparison does not confirm that an underlying cause has been fixed.", { size: 9, color: COLORS.muted });
  }

  if (inspection.progressPhotos?.length) {
    layout.heading("Repair progress photos");
    layout.photoGrid(inspection.progressPhotos, {
      captionFor: (photo) => `${STAGE_LABELS[photo.stage] ?? "Photo"} - ${formatDate(photo.addedAt)}${photo.caption ? `: ${photo.caption}` : ""}`,
    });
  }

  if (inspection.notes?.length) {
    layout.heading("Notes");
    layout.bullets(inspection.notes.map((note) => `${formatDate(note.at)}: ${note.text}`));
  }
  if (inspection.resolved && inspection.resolutionNote) {
    layout.heading("Resolution");
    layout.text(inspection.resolutionNote);
  }
}

/**
 * Builds a PDF for one inspection or a whole job.
 * `earlierById` maps an inspection id to its earlier (parent) inspection.
 */
export async function buildPdf({ inspections, job = null, customer = null, business = {}, earlierById = {} }) {
  const JsPdf = await loadJsPdf();
  const doc = new JsPdf({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({
    title: job ? `Inspection report - ${job.title}` : `Inspection report - ${inspectionTitle(inspections[0])}`,
    creator: "FixSight",
  });
  const layout = new Layout(doc, business);
  header(layout, {
    title: job ? "Job Inspection Report" : "Inspection Report",
    subtitle: `Prepared ${formatDate(new Date().toISOString())}`,
  });

  if (customer || job) {
    const lines = [];
    if (customer) lines.push(`Customer: ${customer.name}${customer.phone ? `  |  ${customer.phone}` : ""}${customer.email ? `  |  ${customer.email}` : ""}`);
    const address = job?.address || customer?.address;
    if (address) lines.push(`Property: ${address}`);
    if (job) lines.push(`Job: ${job.title}  |  Status: ${job.status.replace(/_/g, " ")}`);
    layout.box(lines, { fill: COLORS.soft, title: "Client & property" });
  }

  inspections.forEach((inspection, index) => {
    if (index > 0) {
      doc.addPage();
      layout.y = layout.margin;
    }
    inspectionSection(layout, inspection, { index, total: inspections.length, earlier: earlierById[inspection.id] ?? null });
  });

  footers(layout);
  return doc.output("blob");
}
