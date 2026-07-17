import assert from "node:assert/strict";
import test from "node:test";

import {
  applySafetyRules,
  parseAnalysis,
} from "../src/diagnosis-contract.js";
import { parseAnalyzeRequest } from "../src/request-schema.js";

const VALID_DIAGNOSIS = {
  subject: "bathroom sink supply line",
  diagnosis: "A compression fitting is leaking",
  likely_cause: "The compression nut is loose or the ferrule is worn",
  severity: 4,
  urgency: "soon",
  confidence: 0.86,
  safe_to_diy: true,
  recommendation: {
    best_fix: "Shut off the water and replace the compression ferrule",
    cheap_or_temp_fix: "Gently tighten the compression nut after shutting off the water",
    tools_or_parts: ["adjustable wrench", "replacement ferrule"],
    difficulty: "moderate",
  },
  risk_if_ignored: "The leak can damage the vanity and surrounding floor",
  needs_professional: false,
  professional_type: null,
  safety_warnings: [],
  disclaimer_required: true,
} as const;

const VALID_ANALYSIS = {
  result_type: "diagnosis",
  note: "The photo is clear enough for a first-look assessment.",
  image_quality: "good",
  retake_guidance: [],
  follow_up_questions: [],
  diagnosis: VALID_DIAGNOSIS,
} as const;

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]).toString(
  "base64",
);
const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString("base64");
const WEBP_BASE64 = Buffer.from("RIFF0000WEBP", "ascii").toString("base64");

function analysisWithDiagnosis(
  diagnosisPatch: Record<string, unknown>,
  wrapperPatch: Record<string, unknown> = {},
): unknown {
  return {
    ...VALID_ANALYSIS,
    ...wrapperPatch,
    diagnosis: {
      ...VALID_DIAGNOSIS,
      ...diagnosisPatch,
    },
  };
}

function withoutProperty(
  value: Readonly<Record<string, unknown>>,
  property: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[property];
  return copy;
}

test("parseAnalysis accepts a complete diagnosis response", () => {
  const parsed = parseAnalysis(VALID_ANALYSIS);

  assert.deepEqual(parsed, VALID_ANALYSIS);
  assert.equal(parsed.diagnosis?.confidence, 0.86);
  assert.equal(parsed.diagnosis?.recommendation.difficulty, "moderate");
});

test("parseAnalysis accepts questions, retake, and cannot-assess responses", async (t) => {
  await t.test("questions", () => {
    const value = {
      result_type: "questions",
      note: "Two details would change the recommendation.",
      image_quality: "usable",
      retake_guidance: [],
      follow_up_questions: [
        {
          id: "leak-duration",
          question: "How long has this been leaking?",
          why_it_matters: "A long-running leak raises the chance of hidden damage.",
          options: ["Today", "A few days", "Weeks or longer"],
        },
      ],
      diagnosis: null,
    };

    assert.deepEqual(parseAnalysis(value), value);
  });

  await t.test("retake", () => {
    const value = {
      result_type: "retake",
      note: "The problem area is too dark to assess.",
      image_quality: "poor",
      retake_guidance: ["Turn on a light", "Move closer to the affected area"],
      follow_up_questions: [],
      diagnosis: null,
    };

    assert.deepEqual(parseAnalysis(value), value);
  });

  await t.test("cannot_assess", () => {
    const value = {
      result_type: "cannot_assess",
      note: "The photo does not show a home repair issue.",
      image_quality: "good",
      retake_guidance: [],
      follow_up_questions: [],
      diagnosis: null,
    };

    assert.deepEqual(parseAnalysis(value), value);
  });
});

test("parseAnalysis rejects malformed response wrappers", async (t) => {
  const fourQuestions = Array.from({ length: 4 }, (_, index) => ({
    id: `question-${index}`,
    question: "A useful question?",
    why_it_matters: "It changes the recommendation.",
    options: ["Yes", "No"],
  }));
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["an array", []],
    ["an unknown result type", { ...VALID_ANALYSIS, result_type: "maybe" }],
    ["a missing result type", withoutProperty(VALID_ANALYSIS, "result_type")],
    ["an invalid image quality", { ...VALID_ANALYSIS, image_quality: "blurry" }],
    ["a non-array retake guidance value", { ...VALID_ANALYSIS, retake_guidance: "move closer" }],
    ["more than three questions", { ...VALID_ANALYSIS, follow_up_questions: fourQuestions }],
    [
      "a malformed question",
      {
        ...VALID_ANALYSIS,
        follow_up_questions: [
          { id: "age", question: "How old is it?", options: ["New", "Old"] },
        ],
      },
    ],
    ["a diagnosis result without a diagnosis", { ...VALID_ANALYSIS, diagnosis: null }],
    ["an unexpected wrapper property", { ...VALID_ANALYSIS, raw_model_text: "ignored?" }],
  ];

  for (const [name, value] of cases) {
    await t.test(name, () => {
      assert.throws(() => parseAnalysis(value));
    });
  }
});

test("parseAnalysis rejects malformed diagnosis fields", async (t) => {
  const recommendationWithoutBestFix = withoutProperty(
    VALID_DIAGNOSIS.recommendation,
    "best_fix",
  );
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    [
      "a missing required field",
      {
        ...VALID_ANALYSIS,
        diagnosis: withoutProperty(VALID_DIAGNOSIS, "likely_cause"),
      },
    ],
    ["severity below zero", analysisWithDiagnosis({ severity: -1 })],
    ["severity above ten", analysisWithDiagnosis({ severity: 11 })],
    ["a fractional severity", analysisWithDiagnosis({ severity: 4.5 })],
    ["confidence below zero", analysisWithDiagnosis({ confidence: -0.01 })],
    ["confidence above one", analysisWithDiagnosis({ confidence: 1.01 })],
    ["a non-finite confidence", analysisWithDiagnosis({ confidence: Number.NaN })],
    ["an unknown urgency", analysisWithDiagnosis({ urgency: "eventually" })],
    ["a string DIY flag", analysisWithDiagnosis({ safe_to_diy: "yes" })],
    [
      "an incomplete recommendation",
      analysisWithDiagnosis({ recommendation: recommendationWithoutBestFix }),
    ],
    [
      "an invalid tools list",
      analysisWithDiagnosis({
        recommendation: {
          ...VALID_DIAGNOSIS.recommendation,
          tools_or_parts: ["wrench", 42],
        },
      }),
    ],
    [
      "an unknown difficulty",
      analysisWithDiagnosis({
        recommendation: {
          ...VALID_DIAGNOSIS.recommendation,
          difficulty: "trivial",
        },
      }),
    ],
    ["an unknown professional type", analysisWithDiagnosis({ professional_type: "wizard" })],
    ["a non-array warnings value", analysisWithDiagnosis({ safety_warnings: "Be careful" })],
    ["a non-boolean disclaimer flag", analysisWithDiagnosis({ disclaimer_required: "yes" })],
    ["an unexpected diagnosis property", analysisWithDiagnosis({ private_reasoning: "hidden" })],
  ];

  for (const [name, value] of cases) {
    await t.test(name, () => {
      assert.throws(() => parseAnalysis(value));
    });
  }
});

test("applySafetyRules overrides electrical, gas, and structural DIY advice", async (t) => {
  for (const professionalType of [
    "electrician",
    "gas_technician",
    "structural_engineer",
  ] as const) {
    await t.test(professionalType, () => {
      const parsed = parseAnalysis(
        analysisWithDiagnosis({
          safe_to_diy: true,
          needs_professional: false,
          professional_type: professionalType,
          safety_warnings: [],
          recommendation: {
            ...VALID_DIAGNOSIS.recommendation,
            difficulty: "easy",
          },
        }),
      );

      const guarded = applySafetyRules(parsed);

      assert.equal(guarded.diagnosis?.safe_to_diy, false);
      assert.equal(guarded.diagnosis?.needs_professional, true);
      assert.equal(guarded.diagnosis?.recommendation.difficulty, "pro-only");
      assert.ok(
        (guarded.diagnosis?.safety_warnings.length ?? 0) > 0,
        "the override must surface an explicit safety warning",
      );
    });
  }
});

test("applySafetyRules leaves an ordinary DIY diagnosis unchanged", () => {
  const parsed = parseAnalysis(VALID_ANALYSIS);
  const guarded = applySafetyRules(parsed);

  assert.deepEqual(guarded, parsed);
  assert.equal(guarded.diagnosis?.safe_to_diy, true);
  assert.equal(guarded.diagnosis?.needs_professional, false);
  assert.deepEqual(guarded.diagnosis?.safety_warnings, []);
});

test("parseAnalyzeRequest parses canonical multi-image input", () => {
  const value = {
    images: [
      { data: JPEG_BASE64, media_type: "image/jpeg" },
      { data: PNG_BASE64, media_type: "image/png" },
      { data: WEBP_BASE64, media_type: "image/webp" },
    ],
    category: "plumbing",
    description: "A slow drip under the bathroom sink",
    answers: [
      {
        question_id: "leak-duration",
        question: "How long has it been leaking?",
        answer: "A few days",
      },
    ],
  };

  const parsed = parseAnalyzeRequest(value);

  assert.deepEqual(parsed, value);
  assert.equal(parsed.images.length, 3);
});

test("parseAnalyzeRequest normalizes the legacy single-image and QA fields", () => {
  const parsed = parseAnalyzeRequest({
    image: JPEG_BASE64,
    mediaType: "image/jpeg",
    category: "plumbing",
    description: "A slow drip",
    qa: [
      {
        question: "How long has it been leaking?",
        answer: "A few days",
      },
    ],
  });

  assert.deepEqual(parsed.images, [
    { data: JPEG_BASE64, media_type: "image/jpeg" },
  ]);
  assert.equal(parsed.answers.length, 1);
  assert.equal(parsed.answers[0]?.question, "How long has it been leaking?");
  assert.equal(parsed.answers[0]?.answer, "A few days");
  assert.ok(parsed.answers[0]?.question_id);
  assert.equal("image" in parsed, false);
  assert.equal("mediaType" in parsed, false);
  assert.equal("qa" in parsed, false);
});

test("parseAnalyzeRequest accepts an image at the decoded ten MiB boundary", () => {
  const data = Buffer.alloc(10 * 1024 * 1024).toString("base64");

  const parsed = parseAnalyzeRequest({
    images: [{ data, media_type: "image/jpeg" }],
    answers: [],
  });

  assert.equal(parsed.images[0]?.data.length, data.length);
});

test("parseAnalyzeRequest rejects invalid image input", async (t) => {
  const validRequest = {
    images: [{ data: JPEG_BASE64, media_type: "image/jpeg" }],
    answers: [],
  };
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
  const fiveImages = Array.from({ length: 5 }, () => ({
    data: JPEG_BASE64,
    media_type: "image/jpeg",
  }));
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["a non-object body", null],
    ["a missing images field", { answers: [] }],
    ["zero images", { ...validRequest, images: [] }],
    ["more than four images", { ...validRequest, images: fiveImages }],
    [
      "an unsupported MIME type",
      { ...validRequest, images: [{ data: JPEG_BASE64, media_type: "image/gif" }] },
    ],
    [
      "a MIME type with parameters",
      {
        ...validRequest,
        images: [{ data: JPEG_BASE64, media_type: "image/jpeg; charset=binary" }],
      },
    ],
    [
      "malformed base64 characters",
      { ...validRequest, images: [{ data: "not+base64!", media_type: "image/jpeg" }] },
    ],
    [
      "malformed base64 padding",
      { ...validRequest, images: [{ data: "YQ===", media_type: "image/jpeg" }] },
    ],
    [
      "a data URL instead of raw base64",
      {
        ...validRequest,
        images: [
          { data: `data:image/jpeg;base64,${JPEG_BASE64}`, media_type: "image/jpeg" },
        ],
      },
    ],
    [
      "an empty image payload",
      { ...validRequest, images: [{ data: "", media_type: "image/jpeg" }] },
    ],
    [
      "an image over ten decoded MiB",
      { ...validRequest, images: [{ data: oversized, media_type: "image/jpeg" }] },
    ],
  ];

  for (const [name, value] of cases) {
    await t.test(name, () => {
      assert.throws(() => parseAnalyzeRequest(value));
    });
  }
});

