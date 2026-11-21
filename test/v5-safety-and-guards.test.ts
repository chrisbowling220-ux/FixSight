import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import sharp from "sharp";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DemoDiagnosisEngine } from "../src/demo-engine.js";
import {
  ANALYSIS_JSON_SCHEMA,
  applySafetyRules,
  normalizeAnalysis,
  parseAnalysis,
  StoredAnalysisSchema,
  upgradeStoredAnalysis,
} from "../src/diagnosis-contract.js";
import { AnthropicDiagnosisEngine, photoLabel } from "../src/diagnosis-engine.js";
import { parseAnalyzeRequest } from "../src/request-schema.js";
import { detectInputHazards, detectOutputHazards } from "../src/safety.js";
import { DailyCapError, DailyCappedEngine } from "../src/usage-guard.js";
import { V5_DIAGNOSIS_FIELDS, V5_REPAIR_STEPS } from "./fixtures.js";

const DIY_DIAGNOSIS = {
  subject: "sink supply line",
  diagnosis: "A compression fitting is dripping",
  likely_cause: "Loose nut",
  severity: 3,
  urgency: "soon",
  confidence: 0.85,
  safe_to_diy: true,
  recommendation: {
    best_fix: "Replace the supply line",
    cheap_or_temp_fix: "Place a tray under it",
    tools_or_parts: ["adjustable wrench"],
    difficulty: "easy",
    repair_steps: [...V5_REPAIR_STEPS],
  },
  risk_if_ignored: "Cabinet damage",
  needs_professional: false,
  professional_type: null,
  safety_warnings: [],
  disclaimer_required: true,
  next_measurement: null,
  ...V5_DIAGNOSIS_FIELDS,
};

function analysis(patch: Record<string, unknown> = {}, wrapper: Record<string, unknown> = {}) {
  return parseAnalysis({
    result_type: "diagnosis",
    note: "Clear photo.",
    image_quality: "good",
    retake_guidance: [],
    follow_up_questions: [],
    safety_notices: [],
    ...wrapper,
    diagnosis: { ...DIY_DIAGNOSIS, ...patch },
  });
}

const categories = (matches: { category: string }[]) => matches.map((match) => match.category).sort();

test("input hazard detection finds stated hazards and respects negation", async (t) => {
  const positive: Array<[string, string]> = [
    ["I smell gas near the stove", "gas"],
    ["there's a rotten egg smell in the basement", "gas"],
    ["The CO alarm keeps going off at night", "carbon_monoxide"],
    ["the outlet sparked when I plugged in the vacuum", "electrical"],
    ["burning smell from the light switch", "electrical"],
    ["There are exposed wires hanging from the ceiling", "electrical"],
    ["water is dripping onto the electrical panel", "water_electrical"],
    ["the ceiling is sagging above the tub", "structural"],
    ["the crack keeps getting wider every month", "structural"],
    ["is this popcorn ceiling safe to scrape?", "hazardous_material"],
    ["there was smoke coming from the dryer", "fire"],
  ];
  for (const [text, category] of positive) {
    await t.test(text, () => {
      assert.ok(categories(detectInputHazards(text)).includes(category), `${text} -> ${category}`);
    });
  }

  const negative = [
    "I don't smell gas at all",
    "no sparks, no burning smell, just a loose cover plate",
    "There is no exposed wiring",
    "The smoke detector chirps when the battery is low",
    "Stain next to the fireplace mantel",
    "the hairline crack arcs across the ceiling",
    "water dripping from the drain outlet under the sink",
    "",
  ];
  for (const text of negative) {
    await t.test(`no hazard: ${text || "(empty)"}`, () => {
      assert.deepEqual(detectInputHazards(text), []);
    });
  }
});

test("output hazard scanning ignores smoke staining but catches scorched outlets", () => {
  assert.deepEqual(detectOutputHazards("Grey smoke staining above a candle shelf"), []);
  assert.deepEqual(categories(detectOutputHazards("Scorched outlet faceplate with melted plastic")), ["electrical"]);
  assert.deepEqual(detectOutputHazards("Water stain around the toilet fixture base"), []);
  assert.deepEqual(categories(detectOutputHazards("Water stain spreading around the light fixture")), ["water_electrical"]);
});

test("a user-reported gas smell becomes a safety notice on any result type", () => {
  const questions = parseAnalysis({
    result_type: "questions",
    note: "Two details would help.",
    image_quality: "usable",
    retake_guidance: [],
    follow_up_questions: [{ id: "q", question: "When?", why_it_matters: "Timing", options: ["Today", "Earlier"] }],
    diagnosis: null,
    safety_notices: [],
  });
  const result = applySafetyRules(questions, { description: "Stain by the furnace and I smell gas" });
  assert.equal(result.safety_notices.length, 1);
  assert.match(result.safety_notices[0]!, /leave the building/i);
  assert.equal(result.diagnosis, null);
});

test("a hazard in the model's own findings forces professional handling even when misclassified", () => {
  const misfiled = analysis({
    observations: ["Scorched outlet faceplate with melted plastic around one slot"],
    professional_type: "general_contractor",
    needs_professional: true,
  });
  const result = applySafetyRules(misfiled);
  const diagnosis = result.diagnosis!;
  assert.equal(diagnosis.safe_to_diy, false);
  assert.equal(diagnosis.recommendation.difficulty, "pro-only");
  assert.deepEqual(diagnosis.recommendation.repair_steps, []);
  assert.deepEqual(diagnosis.recommendation.tools_or_parts, []);
  assert.equal(diagnosis.cost_estimate.diy_materials, null);
  assert.ok(diagnosis.safety_warnings.some((warning) => /electrician/i.test(warning)));
});

test("a user-described hazard forces professional handling of a diagnosis", () => {
  const result = applySafetyRules(analysis(), { answers: ["Yes, it sparked once"] });
  assert.equal(result.diagnosis?.safe_to_diy, false);
  assert.equal(result.diagnosis?.needs_professional, true);
  assert.equal(result.diagnosis?.professional_type, "other");
  assert.ok(result.safety_notices.length > 0);
});

test("advice the model marks unsafe for DIY never ships with DIY steps or costs", () => {
  const result = applySafetyRules(analysis({ safe_to_diy: false, needs_professional: true, professional_type: "plumber" }));
  const diagnosis = result.diagnosis!;
  assert.deepEqual(diagnosis.recommendation.repair_steps, []);
  assert.deepEqual(diagnosis.recommendation.tools_or_parts, []);
  assert.equal(diagnosis.cost_estimate.diy_materials, null);
  assert.deepEqual(diagnosis.cost_estimate.professional_total, V5_DIAGNOSIS_FIELDS.cost_estimate.professional_total);
  // Not a hazardous trade, so difficulty is the model's own.
  assert.equal(diagnosis.recommendation.difficulty, "easy");
});

test("a suspected asbestos mention adds a warning without blocking safe DIY", () => {
  const result = applySafetyRules(analysis(), { description: "old popcorn ceiling with a small water stain" });
  assert.equal(result.diagnosis?.safe_to_diy, true);
  assert.ok(result.diagnosis?.safety_warnings.some((warning) => /asbestos/i.test(warning)));
  assert.deepEqual(result.diagnosis?.recommendation.repair_steps, [...V5_REPAIR_STEPS]);
});

test("an ordinary DIY diagnosis passes through the safety layer unchanged", () => {
  const value = analysis();
  assert.deepEqual(applySafetyRules(value, { description: "dripping under the kitchen sink" }), value);
});

test("normalization repairs reversed ranges and an unnamed referral instead of discarding the result", () => {
  const raw = {
    result_type: "diagnosis",
    note: "ok",
    image_quality: "good",
    retake_guidance: [],
    follow_up_questions: [],
    safety_notices: [],
    diagnosis: {
      ...DIY_DIAGNOSIS,
      needs_professional: true,
      professional_type: null,
      cost_estimate: {
        ...DIY_DIAGNOSIS.cost_estimate,
        professional_total: { low: 400, high: 150 },
      },
      labor_estimate: { ...DIY_DIAGNOSIS.labor_estimate, hours_low: 3, hours_high: 1 },
    },
  };
  const parsed = parseAnalysis(normalizeAnalysis(raw));
  assert.deepEqual(parsed.diagnosis?.cost_estimate.professional_total, { low: 150, high: 400 });
  assert.equal(parsed.diagnosis?.labor_estimate?.hours_low, 1);
  assert.equal(parsed.diagnosis?.professional_type, "other");
});

test("the strict contract requires observations and causes on new diagnoses", () => {
  assert.throws(() => analysis({ observations: [] }));
  assert.throws(() => analysis({ possible_causes: [] }));
  assert.throws(() => analysis({ cost_estimate: { ...DIY_DIAGNOSIS.cost_estimate, assumptions: [] } }));
});

test("legacy v4 records upgrade to the stored-record schema", () => {
  const legacy = {
    result_type: "diagnosis",
    note: "Old record",
    image_quality: "good",
    retake_guidance: [],
    follow_up_questions: [],
    diagnosis: {
      subject: "wall",
      diagnosis: "crack",
      likely_cause: "settling",
      severity: 2,
      urgency: "cosmetic",
      confidence: 0.8,
      safe_to_diy: true,
      recommendation: { best_fix: "patch", cheap_or_temp_fix: "caulk", tools_or_parts: [], difficulty: "easy" },
      risk_if_ignored: "cosmetic",
      needs_professional: false,
      professional_type: null,
      safety_warnings: [],
      disclaimer_required: true,
    },
  };
  const upgraded = StoredAnalysisSchema.parse(upgradeStoredAnalysis(legacy));
  assert.deepEqual(upgraded.diagnosis?.observations, []);
  assert.deepEqual(upgraded.diagnosis?.recommendation.repair_steps, []);
  assert.equal(upgraded.diagnosis?.cost_estimate.professional_total, null);
  assert.equal(upgraded.diagnosis?.next_measurement, null);
  assert.deepEqual(upgraded.safety_notices, []);
});

test("the structured-output schema stays within the API's union budget", () => {
  const text = JSON.stringify(ANALYSIS_JSON_SCHEMA);
  const unions = (text.match(/"anyOf"/g) ?? []).length;
  assert.ok(unions <= 12, `schema uses ${unions} anyOf unions`);
  // Every object must forbid additional properties for structured outputs.
  const objects = (text.match(/"type":"object"/g) ?? []).length;
  const closed = (text.match(/"additionalProperties":false/g) ?? []).length;
  assert.equal(closed, objects);
});

test("requests accept photo roles, annotations, and user measurements", () => {
  const request = parseAnalyzeRequest({
    images: [
      { data: "AAAA", media_type: "image/jpeg", role: "wide" },
      { data: "AAAA", media_type: "image/jpeg", role: "close_up", annotated: true },
    ],
    readings: [{ kind: "dimension", what: "crack width", value: 3, unit: "mm", location: "above the door" }],
  });
  assert.equal(request.images[1]?.annotated, true);
  assert.equal(request.readings[0]?.kind, "dimension");
  assert.throws(() => parseAnalyzeRequest({
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
    readings: [{ kind: "dimension", what: "gap", value: 3, unit: "yards", location: "door" }],
  }));
  assert.throws(() => parseAnalyzeRequest({
    images: [{ data: "AAAA", media_type: "image/jpeg", role: "selfie" }],
  }));
});

test("photo labels tell the model the framing and that marks are annotations", () => {
  assert.equal(photoLabel({ data: "", media_type: "image/jpeg" }, 0, 1), "Photo 1 of 1.");
  const label = photoLabel({ data: "", media_type: "image/jpeg", role: "close_up", annotated: true }, 1, 2);
  assert.match(label, /^Photo 2 of 2 \(close-up of the problem area\)\./);
  assert.match(label, /annotations, not damage/);
});

async function jpeg(): Promise<string> {
  return (await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
}

function providerReply(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
    model: "claude-opus-5",
  };
}

test("the engine labels photos, omits vision_mode, applies safety context, and uses the v5 token ceiling", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const engine = new AnthropicDiagnosisEngine(loadConfig({ ANTHROPIC_API_KEY: "synthetic" }));
  Object.defineProperty(engine, "client", {
    value: { messages: { create: async (input: Record<string, unknown>) => { calls.push(input); return providerReply(analysis()); } } },
  });
  const data = await jpeg();
  const result = await engine.analyze(parseAnalyzeRequest({
    images: [{ data, media_type: "image/jpeg", role: "wide" }],
    description: "the outlet sparked",
    vision_mode: "thermal",
  }));
  const call = calls[0]!;
  assert.equal(call.max_tokens, 16_000);
  const content = (call.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]!.content;
  assert.equal(content[0]?.type, "text");
  assert.match(content[0]!.text!, /Photo 1 of 1 \(wide shot/);
  assert.equal(content[1]?.type, "image");
  const context = content.at(-1)!.text!;
  assert.doesNotMatch(context, /vision_mode/);
  assert.equal(result.analysis.diagnosis?.safe_to_diy, false, "user-described sparking forces pro-only");
  assert.equal(result.metadata.prompt_version, "prompt_v5");
});

test("the refusal fallback uses the beta endpoint only when configured", async () => {
  const betaCalls: Array<Record<string, unknown>> = [];
  const engine = new AnthropicDiagnosisEngine(loadConfig({
    ANTHROPIC_API_KEY: "synthetic",
    FIXSIGHT_REFUSAL_FALLBACK_MODEL: "claude-opus-4-8",
  }));
  Object.defineProperty(engine, "client", {
    value: {
      messages: { create: async () => { throw new Error("standard endpoint must not be used"); } },
      beta: { messages: { create: async (input: Record<string, unknown>) => { betaCalls.push(input); return { ...providerReply(analysis()), model: "claude-opus-4-8" }; } } },
    },
  });
  const result = await engine.analyze(parseAnalyzeRequest({ images: [{ data: await jpeg(), media_type: "image/jpeg" }] }));
  assert.deepEqual(betaCalls[0]?.betas, ["server-side-fallback-2026-06-01"]);
  assert.deepEqual(betaCalls[0]?.fallbacks, [{ model: "claude-opus-4-8" }]);
  assert.equal(result.metadata.model_id, "claude-opus-4-8", "records the model that actually served");
  assert.equal(loadConfig({}).refusalFallbackModel, undefined, "off by default");
});

test("the daily cap refuses further paid analyses until the next UTC day", async () => {
  let now = new Date("2026-11-21T10:00:00Z");
  let calls = 0;
  const capped = new DailyCappedEngine({ analyze: async () => { calls += 1; return { analysis: analysis(), metadata: { model_id: "m", prompt_version: "p" } }; } }, 2, () => now);
  const request = parseAnalyzeRequest({ images: [{ data: "AAAA", media_type: "image/jpeg" }] });
  await capped.analyze(request);
  await capped.analyze(request);
  await assert.rejects(capped.analyze(request), DailyCapError);
  assert.equal(calls, 2);
  now = new Date("2026-11-22T00:00:01Z");
  await capped.analyze(request);
  assert.equal(calls, 3);
});

async function serve(env: Record<string, string>) {
  const config = loadConfig(env);
  const app = createApp({ config, engine: new DemoDiagnosisEngine(0) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("the optional access code gates paid endpoints and is reported by health", async () => {
  const { base, close } = await serve({ FIXSIGHT_ACCESS_CODE: "site-visit-42", FIXSIGHT_DEMO_MODE: "true" });
  try {
    const health = await (await fetch(`${base}/api/health`)).json() as Record<string, unknown>;
    assert.equal(health.access_code_required, true);
    assert.equal(health.demo_mode, true);
    const body = JSON.stringify({ images: [{ data: await jpeg(), media_type: "image/jpeg" }], description: "drywall crack" });
    const headers = { "content-type": "application/json" };
    const denied = await fetch(`${base}/api/analyze`, { method: "POST", headers, body });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json() as { code: string }).code, "access_code_required");
    const wrong = await fetch(`${base}/api/analyze`, { method: "POST", headers: { ...headers, "x-fixsight-access-code": "nope" }, body });
    assert.equal(wrong.status, 401);
    const allowed = await fetch(`${base}/api/analyze`, { method: "POST", headers: { ...headers, "x-fixsight-access-code": "site-visit-42" }, body });
    assert.equal(allowed.status, 200);
    const voice = await fetch(`${base}/api/voice/synthesize`, { method: "POST", headers, body: JSON.stringify({ text: "hi" }) });
    assert.equal(voice.status, 401, "voice is gated too");
    assert.equal((await fetch(`${base}/api/voice/status`)).status, 200, "status stays open");
  } finally {
    await close();
  }
});

test("non-production Vercel deployments are locked to demo mode without provider keys", async () => {
  const { createDiagnosisEngine } = await import("../src/usage-guard.js");
  const { createVoiceService } = await import("../src/voice/index.js");
  const keys = { ANTHROPIC_API_KEY: "sk-real-looking", ELEVENLABS_API_KEY: "el-real-looking" };

  for (const environment of ["preview", "development", undefined]) {
    const config = loadConfig({ ...keys, VERCEL: "1", ...(environment ? { VERCEL_ENV: environment } : {}) });
    assert.equal(config.previewLockdown, true, `VERCEL_ENV=${environment}`);
    assert.equal(config.demoMode, true);
    assert.equal(config.anthropicApiKey, undefined, "Anthropic key is dropped");
    assert.equal(config.voice.apiKey, undefined, "ElevenLabs key is dropped");
    assert.ok(createDiagnosisEngine(config) instanceof DemoDiagnosisEngine);
    assert.equal(createVoiceService(config.voice).status().available, false);
  }

  const production = loadConfig({ ...keys, VERCEL: "1", VERCEL_ENV: "production" });
  assert.equal(production.previewLockdown, false);
  assert.equal(production.demoMode, false);
  assert.equal(production.anthropicApiKey, "sk-real-looking");
  assert.equal(production.deploymentEnvironment, "production");

  const local = loadConfig(keys);
  assert.equal(local.previewLockdown, false, "local development is unaffected");
  assert.equal(local.deploymentEnvironment, "local");

  const optedIn = loadConfig({ ...keys, VERCEL: "1", VERCEL_ENV: "preview", FIXSIGHT_ALLOW_PAID_PREVIEW: "true" });
  assert.equal(optedIn.demoMode, false, "explicit opt-in restores paid providers on a preview");

  const { base, close } = await serve({ ...keys, VERCEL: "1", VERCEL_ENV: "preview" });
  try {
    const health = await (await fetch(`${base}/api/health`)).json() as Record<string, unknown>;
    assert.equal(health.demo_mode, true);
    assert.equal(health.environment, "preview");
    assert.equal(health.paid_providers_enabled, false);
  } finally {
    await close();
  }
});

test("the demo engine walks questions to diagnosis and covers every result type", async () => {
  const engine = new DemoDiagnosisEngine(0);
  const image = [{ data: "AAAA", media_type: "image/jpeg" }];
  const first = await engine.analyze(parseAnalyzeRequest({ images: image, description: "brown stain on the ceiling" }));
  assert.equal(first.analysis.result_type, "questions");
  assert.match(first.analysis.note, /^Demo result/);
  const answers = first.analysis.follow_up_questions.map((question) => ({
    question_id: question.id, question: question.question, answer: question.options[0]!,
  }));
  const second = await engine.analyze(parseAnalyzeRequest({ images: image, description: "brown stain on the ceiling", answers }));
  assert.equal(second.analysis.result_type, "diagnosis");
  assert.ok(second.analysis.diagnosis!.recommendation.repair_steps.length >= 4);

  const electrical = await engine.analyze(parseAnalyzeRequest({ images: image, category: "Electrical", description: "outlet discolored" }));
  assert.equal(electrical.analysis.diagnosis?.recommendation.difficulty, "pro-only");
  assert.ok(electrical.analysis.safety_notices.length === 0);
  assert.equal((await engine.analyze(parseAnalyzeRequest({ images: image, description: "blurry photo" }))).analysis.result_type, "retake");
  assert.equal((await engine.analyze(parseAnalyzeRequest({ images: image, description: "my car" }))).analysis.result_type, "cannot_assess");
  for (const description of ["window fogged", "sink pipe drip", "drywall crack", "scuff"]) {
    const result = await engine.analyze(parseAnalyzeRequest({ images: image, description, answers: [{ question_id: "q", question: "q", answer: "a" }] }));
    assert.equal(result.analysis.result_type, "diagnosis", description);
    assert.equal(result.metadata.model_id, "demo");
  }
});

test("Vercel serves static pages with the same security headers as the app, and allows long analyses", async () => {
  const { readFileSync } = await import("node:fs");
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    fluid: boolean;
    functions: Record<string, { maxDuration: number }>;
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  assert.equal(vercel.fluid, true);
  // The web client waits 150 s; the function must be allowed to finish first.
  assert.ok(vercel.functions["api/index.js"]!.maxDuration >= 150);
  const staticHeaders = Object.fromEntries(
    vercel.headers.find((rule) => rule.source === "/((?!api/).*)")!.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  const { base, close } = await serve({});
  try {
    const response = await fetch(`${base}/`);
    for (const name of ["content-security-policy", "permissions-policy", "referrer-policy", "x-content-type-options", "x-frame-options", "cross-origin-opener-policy"]) {
      assert.equal(staticHeaders[name], response.headers.get(name), `${name} matches the Express header`);
    }
  } finally {
    await close();
  }
});
