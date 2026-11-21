// End-to-end browser tests of the FixSight web app against a demo-mode server.
// Run: npm run test:e2e   (needs Google Chrome or CHROME_PATH; WebKit optional)
//
// Every analysis here is served by the demo engine: no AI provider is called.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import type { Browser, BrowserContext, Page } from "playwright-core";

import { DEVICES, launch, startDemoServer, stainPhoto, type RunningServer } from "./harness.js";

const ARTIFACTS = path.resolve(import.meta.dirname, "artifacts");
mkdirSync(ARTIFACTS, { recursive: true });

let server: RunningServer;
let browser: Browser;
let sharpPhoto: string;
let blurryPhoto: string;
let secondPhoto: string;

before(async () => {
  server = await startDemoServer();
  browser = await launch("chrome");
  sharpPhoto = path.join(ARTIFACTS, "stain.jpg");
  blurryPhoto = path.join(ARTIFACTS, "stain-blurry.jpg");
  secondPhoto = path.join(ARTIFACTS, "stain-wide.jpg");
  writeFileSync(sharpPhoto, await stainPhoto());
  writeFileSync(blurryPhoto, await stainPhoto(1600, 1200, 14));
  writeFileSync(secondPhoto, await stainPhoto(2000, 1500));
});

after(async () => {
  await browser?.close();
  await server?.close();
});

interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

const SPEECH_STUB = `
  window.__spoken = [];
  window.__autoEnd = false;
  window.__transcripts = ["water drips from it when it rains"];
  const synth = {
    paused: false,
    speak(utterance) { window.__spoken.push(utterance.text); if (window.__autoEnd) setTimeout(() => utterance.onend && utterance.onend(), 5); },
    cancel() { window.__cancelled = (window.__cancelled || 0) + 1; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    getVoices() { return []; },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  class FakeRecognition {
    start() {
      setTimeout(() => {
        const transcript = window.__transcripts.shift();
        if (transcript && this.onresult) this.onresult({ results: [[{ transcript }]] });
        if (!this.continuous && this.onend) this.onend();
      }, 40);
    }
    stop() { if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRecognition;
`;

async function open(device: keyof typeof DEVICES, options: { speech?: boolean; route?: string } = {}): Promise<Session> {
  const context = await browser.newContext({ ...DEVICES[device], acceptDownloads: true });
  if (options.speech) await context.addInitScript(SPEECH_STUB);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${server.url}/${options.route ?? ""}`);
  await page.waitForSelector(".screen-title");
  await page.waitForFunction(() => document.querySelector("#connection")?.getAttribute("data-state") !== "checking");
  return { context, page, errors };
}

async function addPhoto(page: Page, file: string) {
  const before = await page.locator(".photo-tile").count();
  await page.setInputFiles("#choose-photos", file);
  await page.waitForFunction((count) => document.querySelectorAll(".photo-tile").length > count, before);
}

/** Runs an analysis from the Inspect screen through any questions to the result. */
async function analyzeToResult(page: Page) {
  await page.click("#analyze-btn");
  await page.waitForSelector("#questions-form, .result-body .diag-title", { timeout: 20_000 });
  if (await page.locator("#questions-form").count()) {
    await page.locator(".q-option").first().click();
    await page.click("#submit-answers");
  }
  await page.waitForSelector(".result-body .diag-title", { timeout: 20_000 });
}

async function quickInspection(page: Page, description = "Brown stain on the ceiling under the bathroom") {
  await page.goto(`${server.url}/#/scan`);
  await page.waitForSelector("#choose-photos", { state: "attached" });
  await addPhoto(page, sharpPhoto);
  await page.fill("#description", description);
  await analyzeToResult(page);
  return page.url().split("/inspection/")[1]!.split("?")[0]!;
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`), fullPage });
}

/** Waits until the result shows a real assessment, not a draft or pending state. */
async function waitForAssessment(page: Page) {
  await page.waitForFunction(() => {
    const title = document.querySelector(".result-body .diag-title")?.textContent ?? "";
    return title !== "" && title !== "Not analyzed yet" && title !== "Waiting for your answers";
  }, null, { timeout: 20_000 });
}

function assertNoErrors(session: Session) {
  assert.deepEqual(session.errors, [], session.errors.join("\n"));
}

// 1–2. Open FixSight and navigate the interface.
test("opens and navigates every main screen on a phone", async () => {
  const session = await open("phone");
  const { page } = session;
  assert.equal(await page.textContent(".screen-title"), "New inspection");
  assert.equal(await page.getAttribute("#connection", "data-state"), "online");
  assert.equal(await page.isVisible("#banner-demo"), true, "demo banner is shown in demo mode");
  for (const [nav, title] of [["inspections", "History"], ["jobs", "Jobs & customers"], ["settings", "Settings"], ["scan", "New inspection"]] as const) {
    await page.click(`.nav a[data-nav="${nav}"]`);
    await page.waitForFunction((expected) => document.querySelector(".screen-title")?.textContent === expected, title);
    assert.equal(await page.getAttribute(`.nav a[data-nav="${nav}"]`, "aria-current"), "page");
  }
  assertNoErrors(session);
  await session.context.close();
});

// 3–10. Photos, description, measurements, annotation, analysis, questions, result, save, reopen.
test("complete inspection: multiple photos, quality check, annotation, measurement, questions, result, reopen", async () => {
  const session = await open("phone");
  const { page } = session;
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) sent.push(JSON.parse(request.postData() ?? "{}"));
  });

  await addPhoto(page, blurryPhoto);
  assert.match(await page.textContent(".photo-tile .quality-warn") ?? "", /blurry/i, "blurry photo is flagged");
  await page.click('.photo-tile[data-index="0"] [data-action="remove"]');
  await addPhoto(page, secondPhoto);
  await addPhoto(page, sharpPhoto);
  assert.equal(await page.locator(".photo-tile .quality-warn").count(), 0, "sharp photos are not flagged");
  await page.click('.photo-tile[data-index="0"] [data-role="wide"]');
  await page.click('.photo-tile[data-index="1"] [data-role="close_up"]');

  // Annotate the close-up by drawing a stroke on the canvas.
  await page.click('.photo-tile[data-index="1"] [data-action="annotate"]');
  const canvas = page.locator(".annotate-canvas");
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await shot(page, "phone-annotate");
  await page.click('[data-action="save"]');
  await page.waitForSelector('.photo-tile[data-index="1"] [data-action="annotate"]:has-text("Edit marks")');

  await page.click('[data-cat="Ceiling / Roof"]');
  await page.fill("#description", "Brown stain on the ceiling under the bathroom");
  await page.click(".measurements summary");
  await page.selectOption("#reading-kind", "dimension");
  await page.fill("#r-what", "stain diameter");
  await page.fill("#r-value", "30");
  await page.selectOption("#r-unit", "cm");
  await page.fill("#r-location", "ceiling below the tub");
  await page.click("#add-reading");
  assert.match(await page.textContent("#reading-list") ?? "", /stain diameter: 30 cm/);
  await shot(page, "phone-inspect-filled", true);

  await page.click("#analyze-btn");
  await page.waitForSelector("#questions-form", { timeout: 20_000 });
  await shot(page, "phone-questions", true);
  const body = sent[0]!;
  const images = body.images as Array<Record<string, unknown>>;
  assert.equal(images.length, 2);
  assert.equal(images[0]!.role, "wide");
  assert.equal(images[1]!.role, "close_up");
  assert.equal(images[1]!.annotated, true);
  assert.deepEqual(body.readings, [{ kind: "dimension", what: "stain diameter", value: 30, unit: "cm", location: "ceiling below the tub" }]);
  assert.equal(body.category, "Ceiling / Roof");

  await page.locator('input[name="q-0"]').first().check();
  await page.fill("#q-free-1", "It feels firm and dry");
  await page.click("#submit-answers");
  await page.waitForSelector(".result-body .diag-title", { timeout: 20_000 });
  const answers = sent[1]!.answers as Array<Record<string, string>>;
  assert.equal(answers[0]!.answer, "Yes, after rain");
  assert.equal(answers[1]!.answer, "It feels firm and dry");

  const result = await page.textContent(".result-body") ?? "";
  for (const section of ["What the photos show", "Possible causes (not confirmed)", "What a photo can't tell us", "Step-by-step repair", "Tools & materials checklist", "Estimated cost & labor", "Follow-up check"]) {
    assert.ok(result.includes(section), `result shows "${section}"`);
  }
  assert.match(result, /\$25–\$70/);
  await shot(page, "phone-result");
  await shot(page, "phone-result-full", true);

  // Checklist progress persists.
  await page.locator('[data-check="steps"][data-index="0"]').check();
  await page.waitForTimeout(200);
  const id = page.url().split("/inspection/")[1]!;
  await page.reload();
  await page.waitForSelector(".result-body .diag-title");
  assert.equal(await page.locator('[data-check="steps"][data-index="0"]').isChecked(), true);

  // Reopen from History and search for it.
  await page.click('.nav a[data-nav="inspections"]');
  await page.waitForSelector(".list-card");
  await page.fill("#search", "water staining");
  assert.equal(await page.locator(".list-card").count(), 1);
  await page.fill("#search", "no such thing");
  assert.equal(await page.locator(".list-card").count(), 0);
  await page.fill("#search", "");
  await page.click(`.list-card[href="#/inspection/${id}"]`);
  await page.waitForSelector(".result-body .diag-title");
  assertNoErrors(session);
  await session.context.close();
});

// 11–12. Customers, jobs, and reports.
test("customer and job records, linking an inspection, job status log, and PDF reports", async () => {
  const session = await open("desktop");
  const { page } = session;
  const inspectionId = await quickInspection(page, "Hairline drywall crack above the door");

  await page.goto(`${server.url}/#/customer/new`);
  await page.fill('input[name="name"]', "Jordan Rivera");
  await page.fill('input[name="phone"]', "555-0100");
  await page.fill('input[name="address"]', "12 Elm Street");
  await page.click('#customer-form button[type="submit"]');
  await page.waitForSelector('a[href^="#/job/new?customer="]');
  await page.click('a[href^="#/job/new?customer="]');
  await page.waitForSelector("#job-form");
  assert.equal(await page.inputValue('input[name="address"]'), "12 Elm Street", "address prefilled from customer");
  await page.fill('input[name="title"]', "Hallway crack repair");
  await page.click('#job-form button[type="submit"]');
  await page.waitForSelector("text=Inspections (0)");
  const jobId = page.url().split("/job/")[1]!;

  await page.goto(`${server.url}/#/inspection/${inspectionId}`);
  await page.waitForSelector("#link-job");
  await page.selectOption("#link-job", jobId);
  await page.waitForSelector(`a[href="#/job/${jobId}"]`);

  await page.goto(`${server.url}/#/job/${jobId}`);
  await page.waitForSelector("text=Inspections (1)");
  await page.selectOption('select[name="status"]', "in_progress");
  await page.click('#job-form button[type="submit"]');
  await page.waitForSelector('.tag[data-job-status="in_progress"]');
  await page.fill("#log-text", "Bought mesh tape and compound");
  await page.click("#add-log");
  await page.waitForSelector("text=Bought mesh tape and compound");
  assert.match(await page.textContent(".notes") ?? "", /Status: In progress/);
  await shot(page, "desktop-job", true);

  const [jobPdf] = await Promise.all([page.waitForEvent("download"), page.click("#job-pdf")]);
  const jobBytes = readFileSync((await jobPdf.path())!);
  assert.equal(jobBytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(jobBytes.length > 20_000, `job PDF has content (${jobBytes.length} bytes)`);
  writeFileSync(path.join(ARTIFACTS, "job-report.pdf"), jobBytes);

  await page.goto(`${server.url}/#/inspection/${inspectionId}`);
  await page.waitForSelector('[data-action="pdf"]');
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="pdf"]')]);
  const bytes = readFileSync((await pdf.path())!);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  writeFileSync(path.join(ARTIFACTS, "inspection-report.pdf"), bytes);

  // Search and filter jobs and customers.
  await page.goto(`${server.url}/#/jobs`);
  await page.fill("#search", "elm street");
  assert.equal(await page.locator(".list-card").count(), 1);
  await page.goto(`${server.url}/#/jobs?tab=customers`);
  await page.fill("#search", "jordan");
  assert.equal(await page.locator(".list-card").count(), 1);
  assertNoErrors(session);
  await session.context.close();
});

test("share summary falls back to the clipboard and includes the safety disclaimer", async () => {
  const session = await open("desktop");
  await session.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.url });
  const { page } = session;
  await quickInspection(page, "Slow drip under the kitchen sink pipe");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await page.click('[data-action="share"]');
  await page.waitForSelector("#toast:not([hidden])");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(text, /Finding: A slow drip at a compression fitting/);
  assert.match(text, /Photo-based first opinion only/);
  assertNoErrors(session);
  await session.context.close();
});

// 13. Compare earlier and current photos; progress photos.
test("follow-up inspection produces a before-and-after comparison; progress photos are saved", async () => {
  const session = await open("tablet");
  const { page } = session;
  const firstId = await quickInspection(page, "Hairline drywall crack above the door");

  await page.setInputFiles("#progress-file", sharpPhoto);
  await page.waitForSelector(".progress-item");

  await page.click(`a[href="#/scan?parent=${firstId}"]`);
  await page.waitForSelector(".framing-guide img");
  assert.match(await page.inputValue("#description"), /Follow-up check of/);
  await addPhoto(page, secondPhoto);
  await analyzeToResult(page);
  await page.click('a[href^="#/compare/"]');
  await page.waitForSelector(".compare-slider");
  await page.locator(".compare-range").fill("20");
  assert.equal(await page.$eval("#compare-slider", (element) => (element as HTMLElement).style.getPropertyValue("--pos")), "20%");
  assert.match(await page.textContent(".screen") ?? "", /Assessed severity is unchanged/);
  await shot(page, "tablet-compare");
  assertNoErrors(session);
  await session.context.close();
});

// 14. Voice controls.
test("voice: dictation fills the description, read-aloud controls, and hands-free steps with voice commands", async () => {
  const session = await open("phone", { speech: true });
  const { page } = session;
  await page.waitForSelector("#mic-btn:not([hidden])");
  await page.click("#mic-btn");
  await page.waitForFunction(() => (document.querySelector("#description") as HTMLTextAreaElement).value.includes("water drips"));

  await addPhoto(page, sharpPhoto);
  await page.fill("#description", "Slow drip under the sink pipe");
  await analyzeToResult(page);

  await page.click('[data-action="read"]');
  await page.waitForSelector('[data-action="read-stop"]:not([hidden])');
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" "));
  assert.match(spoken, /slow drip at a compression fitting/i);
  assert.match(spoken, /not an on-site inspection/);
  await page.click('[data-action="read-toggle"]');
  assert.equal(await page.textContent('[data-action="read-toggle"]'), "Resume");
  await page.click('[data-action="read-stop"]');
  await page.waitForSelector('[data-action="read"]:not([hidden])');

  await page.evaluate(() => {
    (window as unknown as { __autoEnd: boolean }).__autoEnd = true;
  });
  await page.click('.actions-panel [data-action="step-mode"]');
  await page.waitForSelector(".step-text");
  assert.match(await page.textContent(".step-top") ?? "", /Step 1 of 6/);
  await page.click('button[data-step="next"]');
  await page.waitForFunction(() => /Step 2 of 6/.test(document.querySelector(".step-top")?.textContent ?? ""));
  await page.evaluate(() => {
    (window as unknown as { __transcripts: string[] }).__transcripts.push("next please");
  });
  await page.check('input[data-step="listen"]');
  await page.waitForFunction(() => /Step 3 of 6/.test(document.querySelector(".step-top")?.textContent ?? ""));
  await page.click('button[data-step="exit"]');
  await page.waitForSelector(".result-body");
  assert.equal(await page.locator('[data-check="steps"][data-index="0"]').isChecked(), true, "steps completed in hands-free mode are ticked");
  assertNoErrors(session);
  await session.context.close();
});

// 15. Error and offline recovery.
test("a server error keeps the inspection as a draft that can be analyzed later", async () => {
  const session = await open("phone");
  const { page } = session;
  await page.route("**/api/analyze", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "not configured", code: "analysis_unavailable" }),
  }));
  await addPhoto(page, sharpPhoto);
  await page.fill("#description", "drywall crack");
  await page.click("#analyze-btn");
  await page.waitForSelector("text=Not analyzed yet");
  assert.match(await page.textContent("#toast") ?? "", /isn't set up for AI analysis/);
  assert.match(await page.textContent(".result-body") ?? "", /Last attempt/);
  await page.unroute("**/api/analyze");
  await page.click('[data-action="analyze"]');
  await waitForAssessment(page);
  assert.match(await page.textContent(".diag-title") ?? "", /drywall crack/i);
  // The browser itself logs the injected 503; nothing else may error.
  assert.deepEqual(session.errors.filter((error) => !/status of 503/.test(error)), []);
  await session.context.close();
});

test("offline: drafts are saved, saved inspections stay viewable, and the app shell loads without a network", async () => {
  const session = await open("phone");
  const { page, context } = session;
  const savedId = await quickInspection(page, "Hairline drywall crack above the door");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.goto(`${server.url}/#/scan`);
  await page.waitForFunction(() => document.querySelector("#connection")?.getAttribute("data-state") === "offline");
  await addPhoto(page, sharpPhoto);
  await page.fill("#description", "Fogged double-pane window");
  assert.match(await page.textContent("#analyze-btn") ?? "", /Save draft/);
  await page.click("#analyze-btn");
  await page.waitForSelector("text=Not analyzed yet");
  const draftId = page.url().split("/inspection/")[1]!;

  await page.reload();
  await page.waitForSelector(".screen .diag-title");
  await page.goto(`${server.url}/#/inspection/${savedId}`);
  await page.waitForSelector(".result-body .diag-title");
  await shot(page, "phone-offline-saved");

  await page.goto(`${server.url}/#/inspection/${draftId}`);
  await page.waitForSelector('[data-action="analyze"]:disabled');
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector("#connection")?.getAttribute("data-state") === "online", null, { timeout: 15_000 });
  // The button re-enables in place when the connection returns.
  await page.waitForSelector('[data-action="analyze"]:not(:disabled)');
  await page.click('[data-action="analyze"]');
  await waitForAssessment(page);
  const errors = session.errors.filter((error) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(error));
  assert.deepEqual(errors, []);
  await context.close();
});

test("an access-code server prompts for the code and then analyzes", async () => {
  const locked = await startDemoServer({ FIXSIGHT_ACCESS_CODE: "crew-2026" });
  const context = await browser.newContext(DEVICES.phone);
  const page = await context.newPage();
  try {
    await page.goto(locked.url);
    await page.waitForSelector("#choose-photos", { state: "attached" });
    await addPhoto(page, sharpPhoto);
    await page.fill("#description", "drywall crack");
    await page.click("#analyze-btn");
    await page.waitForSelector("#access-form");
    await page.fill('#access-form input[name="code"]', "crew-2026");
    await page.click('#access-form button[type="submit"]');
    await page.waitForSelector("text=Access code saved.");
    await page.goto(`${locked.url}/#/inspections`);
    await page.click(".list-card");
    await page.click('[data-action="analyze"]');
    await waitForAssessment(page);
  } finally {
    await context.close();
    await locked.close();
  }
});

test("earlier browser history is migrated into History and stays readable", async () => {
  const context = await browser.newContext(DEVICES.phone);
  await context.addInitScript(() => {
    if (localStorage.getItem("fixsight_history")) return;
    localStorage.setItem("fixsight_history", JSON.stringify([{
      id: 1, date: "2026-10-01T12:00:00.000Z", thumb: null, category: "Plumbing",
      result: { result_type: "diagnosis", note: "Old scan", image_quality: "good", retake_guidance: [], follow_up_questions: [],
        diagnosis: { subject: "sink trap", diagnosis: "Loose slip nut on the sink trap", likely_cause: "Washer worn", severity: 3, urgency: "soon", confidence: 0.8,
          safe_to_diy: true, recommendation: { best_fix: "Replace the washer", cheap_or_temp_fix: "Hand-tighten", tools_or_parts: ["slip washer"], difficulty: "easy" },
          risk_if_ignored: "Cabinet damage", needs_professional: false, professional_type: null, safety_warnings: [], disclaimer_required: true } },
    }, {
      id: 2, date: "2026-09-01T12:00:00.000Z", category: null,
      result: { result_type: "diagnosis", diagnosis: { likely_diagnosis: "Cracked tile grout", severity_score: 2, diy_or_pro: "diy", recommended_repair: "Regrout", estimated_cost_range: "$20-$40" } },
    }]));
  });
  const page = await context.newPage();
  await page.goto(`${server.url}/#/inspections`);
  await page.waitForSelector(".list-card");
  assert.equal(await page.locator(".list-card").count(), 2);
  await page.click("text=Loose slip nut on the sink trap");
  await page.waitForSelector(".result-body .diag-title");
  assert.match(await page.textContent(".result-body") ?? "", /Replace the washer/);
  await page.goto(`${server.url}/#/inspections`);
  await page.click("text=Cracked tile grout");
  await page.waitForSelector(".result-body .diag-title");
  assert.match(await page.textContent(".result-body") ?? "", /\$20-\$40/);
  await context.close();
});

test("backup export and import restore inspections after deleting all data", async () => {
  const session = await open("desktop");
  const { page } = session;
  await quickInspection(page, "Slow drip under the sink pipe");
  await page.goto(`${server.url}/#/settings`);
  await page.waitForSelector("#export");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
  const backupPath = path.join(ARTIFACTS, "backup.json");
  await download.saveAs(backupPath);
  assert.equal(JSON.parse(readFileSync(backupPath, "utf8")).format, "fixsight-backup-v1");

  await page.click("#clear");
  await page.click('.modal [data-action="ok"]');
  await page.waitForSelector("text=New inspection");
  await page.goto(`${server.url}/#/inspections`);
  await page.waitForSelector("text=No inspections yet");

  await page.goto(`${server.url}/#/settings`);
  await page.setInputFiles("#import", backupPath);
  await page.waitForSelector("text=/Imported \\d+ record/");
  await page.goto(`${server.url}/#/inspections`);
  await page.waitForSelector(".list-card");
  assertNoErrors(session);
  await session.context.close();
});

// Passed as a string: tsx's name-preserving transform would otherwise inject a
// helper (__name) that does not exist inside the page.
const AUDIT_SCRIPT = `(() => {
  const issues = [];
  const visible = (element) => element.offsetParent !== null || element.getClientRects().length > 0;
  for (const element of document.querySelectorAll("button, a[href]")) {
    if (!visible(element)) continue;
    const name = (element.textContent || "").trim() || element.getAttribute("aria-label") || element.getAttribute("title");
    if (!name) issues.push("unnamed " + element.tagName.toLowerCase() + " " + element.outerHTML.slice(0, 80));
  }
  for (const image of document.querySelectorAll("img")) if (!image.hasAttribute("alt")) issues.push("img without alt " + image.outerHTML.slice(0, 80));
  for (const input of document.querySelectorAll("input:not([type=hidden]):not([type=file]), select, textarea")) {
    if (!visible(input)) continue;
    const labelled = input.closest("label") || (input.id && document.querySelector('label[for="' + input.id + '"]')) || input.getAttribute("aria-label");
    if (!labelled) issues.push("unlabelled " + input.outerHTML.slice(0, 80));
  }
  for (const target of document.querySelectorAll(".btn, .chip, .nav a")) {
    if (!visible(target)) continue;
    const rect = target.getBoundingClientRect();
    if (rect.height < 36) issues.push("small target " + Math.round(rect.height) + "px " + target.outerHTML.slice(0, 60));
  }
  return issues;
})()`;

test("four large photos are shrunk for sending so the request fits the host's 4.5 MB limit", async () => {
  const sharp = (await import("sharp")).default;
  const files: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const width = 2400;
    const height = 1800;
    const noise = Buffer.alloc(width * height * 3);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761 + index * 97) >>> 24;
    const file = path.join(ARTIFACTS, `noise-${index}.jpg`);
    await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toFile(file);
    files.push(file);
  }
  const session = await open("phone");
  const { page } = session;
  const sizes: number[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) sizes.push(Buffer.byteLength(request.postData() ?? ""));
  });
  for (const file of files) await addPhoto(page, file);
  await page.fill("#description", "Hairline drywall crack above the door");
  await page.click("#analyze-btn");
  await waitForAssessment(page);
  assert.equal(sizes.length, 1);
  assert.ok(sizes[0]! < 4_500_000, `request body ${sizes[0]} bytes`);
  // Stored photos keep their full quality for reports.
  const stored = await page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open("fixsight");
    open.onsuccess = () => {
      const all = open.result.transaction("inspections").objectStore("inspections").getAll();
      all.onsuccess = () => resolve(all.result[0].photos.reduce((sum: number, photo: { dataUrl: string }) => sum + photo.dataUrl.length, 0));
    };
  }));
  assert.ok(stored > sizes[0]!, "originals are stored larger than what was sent");
  assertNoErrors(session);
  await session.context.close();
});

// 16. Responsive layouts and basic accessibility on phone, tablet, and desktop.
test("layouts fit phone, tablet, and desktop without sideways scrolling, with labelled controls", async () => {
  for (const device of ["phone", "tablet", "desktop"] as const) {
    const session = await open(device);
    const { page } = session;
    const id = await quickInspection(page, "Brown stain on the ceiling under the bathroom");
    for (const route of ["#/scan", "#/inspections", `#/inspection/${id}`, "#/jobs", "#/job/new", "#/settings"]) {
      await page.goto(`${server.url}/${route}`);
      await page.waitForSelector(".screen-title, .result-body");
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${device} ${route} overflows horizontally by ${overflow}px`);
      const problems = (await page.evaluate(AUDIT_SCRIPT)) as string[];
      assert.deepEqual(problems, [], `${device} ${route}`);
      const name = `${device}-${route.replace(/[#/]+/g, "-").replace(/inspection-insp_[^-]+.*/, "inspection-detail").replace(/^-|-$/g, "")}`;
      await shot(page, name);
    }
    const navPosition = await page.$eval(".nav", (element) => getComputedStyle(element).position);
    assert.equal(navPosition, device === "phone" ? "fixed" : "sticky", `${device} navigation placement`);
    assertNoErrors(session);
    await session.context.close();
  }
});

test("Safari engine (WebKit) runs the core inspection flow at iPhone size", async (t) => {
  let webkitBrowser: Browser;
  try {
    webkitBrowser = await launch("webkit");
  } catch (error) {
    t.skip(`WebKit is not installed here: ${(error as Error).message.split("\n")[0]}`);
    return;
  }
  try {
    const context = await webkitBrowser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForSelector("#choose-photos", { state: "attached" });
    await addPhoto(page, sharpPhoto);
    await page.fill("#description", "Brown stain on the ceiling under the bathroom");
    await analyzeToResult(page);
    await shot(page, "webkit-iphone-result");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await webkitBrowser.close();
  }
});
