import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { loadConfig } from "../src/config.js";
import { AnthropicDiagnosisEngine } from "../src/diagnosis-engine.js";
import { parseAnalyzeRequest } from "../src/request-schema.js";
import { V5_DIAGNOSIS_FIELDS } from "./fixtures.js";

const scenarios = [
  ["Water damage and hidden leaks", "plumber"], ["Cracked drywall", "general_contractor"],
  ["Roof leaks", "roofer"], ["Electrical concerns", "electrician"],
  ["Gas appliance concerns", "gas_technician"], ["Structural cracks", "structural_engineer"],
  ["Foundation issues", "foundation_specialist"], ["HVAC failures", "hvac"],
  ["Plumbing problems", "plumber"], ["Appliances", "other"], ["Vehicle and equipment problems", "other"],
] as const;

const mockDiagnosis = (professional: string) => ({
  result_type: "diagnosis", note: "A photo cannot confirm the cause.", image_quality: "good",
  retake_guidance: [], follow_up_questions: [], safety_notices: [],
  diagnosis: {
    subject: "test subject", diagnosis: "An uncertain visible issue", likely_cause: "Several causes are possible",
    severity: 4, urgency: "soon", confidence: 0.8, safe_to_diy: true,
    recommendation: { best_fix: "Arrange an inspection", cheap_or_temp_fix: "Avoid disturbing the area", tools_or_parts: [], difficulty: "moderate", repair_steps: [] },
    risk_if_ignored: "The condition may worsen", needs_professional: false, professional_type: professional,
    safety_warnings: [], disclaimer_required: false, next_measurement: null,
    ...V5_DIAGNOSIS_FIELDS,
  },
});

function fakeEngine(response: unknown, calls: unknown[]) {
  const engine = new AnthropicDiagnosisEngine(loadConfig({ ANTHROPIC_API_KEY: "synthetic-test-key" }));
  Object.defineProperty(engine, "client", { value: { messages: { create: async (input: unknown) => {
    calls.push(input);
    return { content: [{ type: "text", text: JSON.stringify(response) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  } } } });
  return engine;
}

test("mocked provider scenarios exercise safety overrides and preserve version metadata", async () => {
  const data = (await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
  for (const [category, professional] of scenarios) {
    const calls: unknown[] = [];
    const engine = fakeEngine(mockDiagnosis(professional), calls);
    const result = await engine.analyze(parseAnalyzeRequest({ images: [{ data, media_type: "image/jpeg" }], category }));
    assert.equal(calls.length, 1, category);
    assert.ok(result.metadata.model_id && result.metadata.prompt_version, category);
    if (["electrician", "gas_technician", "structural_engineer"].includes(professional)) {
      assert.equal(result.analysis.diagnosis?.safe_to_diy, false, category);
      assert.equal(result.analysis.diagnosis?.needs_professional, true, category);
      assert.ok(result.analysis.diagnosis?.safety_warnings.length, category);
    }
  }
});

test("mocked provider may decline to assess insufficient evidence", async () => {
  const data = (await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
  const calls: unknown[] = [];
  const engine = fakeEngine({ result_type: "cannot_assess", note: "Evidence is insufficient.", image_quality: "usable", retake_guidance: [], follow_up_questions: [], diagnosis: null, safety_notices: [] }, calls);
  const result = await engine.analyze(parseAnalyzeRequest({ images: [{ data, media_type: "image/jpeg" }] }));
  assert.equal(result.analysis.result_type, "cannot_assess");
  assert.equal(result.analysis.diagnosis, null);
});

test("mocked provider output with missing diagnosis fields is rejected", async () => {
  const data = (await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
  const calls: unknown[] = [];
  const engine = fakeEngine({ result_type: "diagnosis", diagnosis: {} }, calls);
  await assert.rejects(engine.analyze(parseAnalyzeRequest({ images: [{ data, media_type: "image/jpeg" }] })), /outside the diagnosis contract/);
});
