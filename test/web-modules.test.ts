// Unit tests for the browser modules that are pure functions (no DOM needed).
import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  buildShareText,
  buildSpeechText,
  displayDiagnosis,
  inspectionTitle,
  renderDiagnosis,
  renderNonDiagnosis,
} from "../public/js/analysis-view.js";
import { ANALYSIS_TIMEOUT_MS, buildAnalyzeBody } from "../public/js/api.js";
import { assessQuality } from "../public/js/photos.js";
import { pdfSafe } from "../public/js/report.js";
import { matchesFilter, searchText } from "../public/js/screens/inspections.js";
import { escapeHtml, html, money, hours } from "../public/js/ui.js";
import { chunkForSpeech, parseCommand } from "../public/js/voice.js";
import { DemoDiagnosisEngine } from "../src/demo-engine.js";
import { parseAnalyzeRequest } from "../src/request-schema.js";

async function demoDiagnosis(description: string) {
  const engine = new DemoDiagnosisEngine(0);
  const result = await engine.analyze(parseAnalyzeRequest({
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
    description,
    answers: [{ question_id: "q", question: "q", answer: "a" }],
  }));
  return result.analysis;
}

test("the html template escapes interpolated text, including model output", () => {
  const hostile = `<img src=x onerror="alert(1)">`;
  const markup = String(html`<p>${hostile}</p>`);
  assert.equal(markup, "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  assert.equal(String(html`<ul>${["<b>", "ok"].map((item) => html`<li>${item}</li>`)}</ul>`), "<ul><li>&lt;b&gt;</li><li>ok</li></ul>");
  assert.equal(escapeHtml(`'"&`), "&#39;&quot;&amp;");
});

test("a diagnosis renders every v5 section and escapes hostile model text", async () => {
  const analysis = await demoDiagnosis("brown ceiling stain");
  const hostile = structuredClone(analysis);
  hostile.diagnosis!.observations = ["<script>alert('x')</script> stain"];
  const markup = String(renderDiagnosis(hostile, { checklistState: { steps: { 0: true } } }));
  assert.ok(!markup.includes("<script>"), "no raw script tag");
  assert.ok(markup.includes("&lt;script&gt;"));
  for (const label of ["What the photos show", "Possible causes (not confirmed)", "What a photo can&#39;t tell us", "Step-by-step repair", "Tools &amp; materials checklist", "Estimated cost &amp; labor", "Measurement that would settle it", "Follow-up check"]) {
    assert.ok(markup.includes(label), label);
  }
  assert.match(markup, /data-check="steps" data-index="0"\s+checked/);
  assert.match(markup, /\$25–\$70/);
});

test("professional-only results show the referral and no DIY checklist", async () => {
  const analysis = await demoDiagnosis("outlet discolored electrical");
  const markup = String(renderDiagnosis(analysis));
  assert.match(markup, /Call a licensed electrician/);
  assert.match(markup, /Don&#39;t attempt this repair yourself/);
  assert.doesNotMatch(markup, /Step-by-step repair/);
  assert.doesNotMatch(markup, /DIY materials/);
});

test("retake and cannot-assess results render guidance and safety notices", () => {
  const markup = String(renderNonDiagnosis({
    result_type: "retake",
    note: "Too dark",
    image_quality: "poor",
    retake_guidance: ["Turn on the lights"],
    follow_up_questions: [],
    diagnosis: null,
    safety_notices: ["If you smell gas now, leave the building."],
  }));
  assert.match(markup, /Let&#39;s retake the photo/);
  assert.match(markup, /Turn on the lights/);
  assert.match(markup, /Safety first/);
});

test("legacy records from the earlier web app still display", () => {
  const v4 = displayDiagnosis({
    subject: "wall", diagnosis: "crack", likely_cause: "settling", severity: 2, urgency: "cosmetic", confidence: 0.81,
    safe_to_diy: true, recommendation: { best_fix: "patch", cheap_or_temp_fix: "caulk", tools_or_parts: ["knife"], difficulty: "easy" },
    risk_if_ignored: "cosmetic", needs_professional: false, professional_type: null, safety_warnings: [], disclaimer_required: true,
  });
  assert.equal(v4.confidenceText, "81%");
  assert.deepEqual(v4.recommendation.repair_steps, []);
  assert.equal(v4.cost_estimate, null);
  const old = displayDiagnosis({ likely_diagnosis: "Cracked grout", severity_score: 12, diy_or_pro: "pro_required", estimated_cost_range: "$20" });
  assert.equal(old.diagnosis, "Cracked grout");
  assert.equal(old.severity, 10, "clamped");
  assert.equal(old.needs_professional, true);
  assert.equal(old.legacy_cost_text, "$20");
  assert.ok(String(renderDiagnosis({ result_type: "diagnosis", diagnosis: { likely_diagnosis: "x" } })).includes("x"));
});

test("share text and speech text lead with safety and end with the limitation", async () => {
  const analysis = await demoDiagnosis("sink pipe drip");
  const withNotice = { ...analysis, safety_notices: ["Shut off the water main if the leak worsens."] };
  const share = buildShareText({ analysis: withNotice, createdAt: "2026-11-21T10:00:00Z" }, { customer: { name: "Jordan" }, job: { title: "Kitchen", address: "12 Elm" } });
  assert.match(share.split("\n")[2]!, /^Customer: Jordan/);
  assert.match(share, /SAFETY: Shut off the water main/);
  assert.match(share, /1\. Turn the shut-off valve/);
  assert.match(share, /Professional estimate: \$125–\$275/);
  assert.match(share.trim().split("\n").at(-1)!, /Photo-based first opinion only/);
  const speech = buildSpeechText(withNotice);
  assert.match(speech, /^Safety first\./);
  assert.doesNotMatch(speech, /[–—]/, "dashes are spoken as pauses");
  assert.match(speech, /not an on-site inspection\.$/);
});

test("the analysis request carries roles, annotation, readings, and omits empty fields", () => {
  const body = buildAnalyzeBody({
    photos: [
      { dataUrl: "data:image/jpeg;base64,AAAA", role: "wide", annotated: false },
      { dataUrl: "data:image/jpeg;base64,BBBB", role: null, annotated: true },
    ],
    category: "",
    description: "",
    readings: [{ kind: "dimension", what: "gap", value: 2, unit: "mm", location: "door" }],
  }, []);
  assert.deepEqual(body.images, [
    { data: "AAAA", media_type: "image/jpeg", role: "wide" },
    { data: "BBBB", media_type: "image/jpeg", annotated: true },
  ]);
  assert.equal("category" in body, false);
  assert.equal("description" in body, false);
  assert.equal(body.readings.length, 1);
  assert.ok(ANALYSIS_TIMEOUT_MS >= 120_000, "deadline allows slow mobile uploads plus model time");
  // The request must satisfy the server contract.
  assert.doesNotThrow(() => parseAnalyzeRequest(body));
});

async function grayscale(buffer: Buffer) {
  const { data, info } = await sharp(buffer).resize({ width: 320 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { gray: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

function texturedSvg(width: number, height: number) {
  const dots = Array.from({ length: 900 }, (_, index) => `<circle cx="${(index * 97) % width}" cy="${(index * 211) % height}" r="${1 + (index % 3)}" fill="#8a8170"/>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f2efe8"/>${dots}<rect x="300" y="200" width="600" height="400" fill="none" stroke="#333" stroke-width="6"/></svg>`);
}

test("photo quality check flags blur, darkness, and glare but passes a sharp photo", async () => {
  const sharpImage = await sharp(texturedSvg(1600, 1200)).jpeg().toBuffer();
  const blurred = await sharp(texturedSvg(1600, 1200)).blur(14).jpeg().toBuffer();
  const dark = await sharp(texturedSvg(1600, 1200)).linear(0.15, 0).jpeg().toBuffer();
  const bright = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fefefe" } }).jpeg().toBuffer();

  const good = await grayscale(sharpImage);
  assert.deepEqual(assessQuality(good.gray, good.width, good.height).warnings, []);
  const soft = await grayscale(blurred);
  assert.deepEqual(assessQuality(soft.gray, soft.width, soft.height).warnings, ["blurry"]);
  const dim = await grayscale(dark);
  assert.ok(assessQuality(dim.gray, dim.width, dim.height).warnings.includes("dark"));
  const glare = await grayscale(bright);
  assert.ok(assessQuality(glare.gray, glare.width, glare.height).warnings.includes("bright"));
});

test("voice commands and speech chunking", () => {
  assert.equal(parseCommand("Next please"), "next");
  assert.equal(parseCommand("go back"), "back");
  assert.equal(parseCommand("can you repeat that"), "repeat");
  assert.equal(parseCommand("stop"), "exit");
  assert.equal(parseCommand("hmm"), null);
  const long = "First sentence here. ".repeat(40);
  const chunks = chunkForSpeech(long, 220);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 220));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), long.trim().replace(/\s+/g, " "));
});

test("PDF text is mapped to characters the standard fonts can draw", () => {
  assert.equal(pdfSafe("$25–$70 “quoted” ≈ 3 mm → done… 🔧"), '$25-$70 "quoted" ~ 3 mm -> done... ');
  assert.equal(pdfSafe("Café 20°F"), "Café 20°F");
});

test("history search and filters", () => {
  const inspection = {
    createdAt: "2026-11-01T00:00:00Z",
    status: "complete",
    category: "Plumbing",
    description: "Under the kitchen sink",
    analysis: { diagnosis: { diagnosis: "Dripping supply line", subject: "sink", likely_cause: "loose nut" } },
    notes: [{ text: "Customer prefers mornings" }],
    resolved: false,
    followUpDue: "2026-11-10T00:00:00Z",
  };
  const text = searchText(inspection, { job: { title: "Rivera kitchen", address: "12 Elm" }, customer: { name: "Jordan Rivera" } });
  for (const term of ["dripping", "plumbing", "kitchen sink", "rivera", "12 elm", "mornings"]) assert.ok(text.includes(term), term);
  const now = new Date("2026-11-21T00:00:00Z");
  assert.equal(matchesFilter(inspection, "open", now), true);
  assert.equal(matchesFilter(inspection, "due", now), true);
  assert.equal(matchesFilter(inspection, "resolved", now), false);
  assert.equal(matchesFilter({ ...inspection, status: "draft" }, "draft", now), true);
  assert.equal(inspectionTitle(inspection), "Dripping supply line");
  assert.equal(inspectionTitle({ status: "draft", description: "check the gutter" }), "Draft: check the gutter");
});

test("money and hour formatting", () => {
  assert.equal(money({ low: 1200, high: 3400 }), "$1,200–$3,400");
  assert.equal(money({ low: 50, high: 50 }), "$50");
  assert.equal(money(null), null);
  assert.equal(hours(0.5, 2), "0.5–2 h");
});

test("the service worker precaches every app module", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const modules = [
    ...readdirSync(new URL("../public/js/", import.meta.url)).filter((file) => file.endsWith(".js")).map((file) => `/js/${file}`),
    ...readdirSync(new URL("../public/js/screens/", import.meta.url)).map((file) => `/js/screens/${file}`),
  ];
  for (const path of modules) assert.ok(sw.includes(`"${path}"`), `${path} is precached`);
  const vendored = readFileSync(new URL("../public/vendor/jspdf.umd.min.js", import.meta.url), "utf8").slice(0, 200);
  const { version } = JSON.parse(readFileSync(new URL("../node_modules/jspdf/package.json", import.meta.url), "utf8"));
  assert.ok(vendored.includes(`Version ${version}`), "vendored jsPDF matches the installed package");
});
