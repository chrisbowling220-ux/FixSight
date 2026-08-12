import { z } from "zod";

export const PROFESSIONAL_TYPES = [
  "electrician",
  "gas_technician",
  "structural_engineer",
  "roofer",
  "plumber",
  "hvac",
  "water_mitigation",
  "mold_remediation",
  "general_contractor",
  "foundation_specialist",
  "other",
] as const;

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const FollowUpQuestionSchema = z
  .object({
    id: nonEmptyText(80),
    question: nonEmptyText(300),
    why_it_matters: nonEmptyText(500),
    options: z.array(nonEmptyText(120)).min(2).max(4),
  })
  .strict();

export const INSTRUMENTS = [
  "moisture_meter",
  "thermal_camera",
  "borescope",
  "wall_scanner",
  "hygrometer",
] as const;

export const NextMeasurementSchema = z
  .object({
    instrument: z.enum(INSTRUMENTS),
    target: nonEmptyText(300),
    why: nonEmptyText(500),
    // The field that makes the loop converge. The model must commit to how it
    // will read a result *before* seeing it; without that it can rationalize any
    // reading into the hypothesis it already holds, and the extra measurement
    // buys nothing.
    expected_discriminator: nonEmptyText(500),
    safety_note: nonEmptyText(300).nullable(),
  })
  .strict();

export const RecommendationSchema = z
  .object({
    best_fix: nonEmptyText(2_000),
    cheap_or_temp_fix: nonEmptyText(2_000),
    tools_or_parts: z.array(nonEmptyText(200)).max(30),
    difficulty: z.enum(["easy", "moderate", "hard", "pro-only"]),
  })
  .strict();

export const DiagnosisSchema = z
  .object({
    subject: nonEmptyText(300),
    diagnosis: nonEmptyText(1_000),
    likely_cause: nonEmptyText(2_000),
    severity: z.number().int().min(0).max(10),
    urgency: z.enum(["cosmetic", "monitor", "soon", "urgent"]),
    confidence: z.number().finite().min(0).max(1),
    safe_to_diy: z.boolean(),
    recommendation: RecommendationSchema,
    risk_if_ignored: nonEmptyText(2_000),
    needs_professional: z.boolean(),
    professional_type: z.enum(PROFESSIONAL_TYPES).nullable(),
    safety_warnings: z.array(nonEmptyText(500)).max(10),
    disclaimer_required: z.boolean(),
    next_measurement: NextMeasurementSchema.nullable(),
  })
  .strict();

const BaseAnalysisSchema = z
  .object({
    result_type: z.enum([
      "questions",
      "diagnosis",
      "retake",
      "cannot_assess",
    ]),
    note: nonEmptyText(1_000),
    image_quality: z.enum(["good", "usable", "poor"]),
    retake_guidance: z.array(nonEmptyText(300)).max(5),
    follow_up_questions: z.array(FollowUpQuestionSchema).max(3),
    diagnosis: DiagnosisSchema.nullable(),
  })
  .strict();

export const AnalysisSchema = BaseAnalysisSchema.superRefine((analysis, context) => {
  const issue = (message: string, path: Array<string | number>) => {
    context.addIssue({ code: "custom", message, path });
  };

  if (analysis.result_type === "diagnosis") {
    if (analysis.diagnosis === null) {
      issue("A diagnosis result must include diagnosis details.", ["diagnosis"]);
    }
    if (analysis.follow_up_questions.length > 0) {
      issue("A diagnosis result cannot include follow-up questions.", [
        "follow_up_questions",
      ]);
    }
    if (analysis.image_quality === "poor") {
      issue("A poor-quality image must use the retake result.", [
        "image_quality",
      ]);
    }
  } else if (analysis.diagnosis !== null) {
    issue("Only a diagnosis result may include diagnosis details.", [
      "diagnosis",
    ]);
  }

  if (analysis.result_type === "questions") {
    if (analysis.follow_up_questions.length === 0) {
      issue("A questions result must include at least one question.", [
        "follow_up_questions",
      ]);
    }
    if (analysis.retake_guidance.length > 0) {
      issue("A questions result cannot include retake guidance.", [
        "retake_guidance",
      ]);
    }
  } else if (analysis.follow_up_questions.length > 0) {
    issue("Only a questions result may include follow-up questions.", [
      "follow_up_questions",
    ]);
  }

  if (analysis.result_type === "retake") {
    if (analysis.image_quality !== "poor") {
      issue("A retake result must mark image quality as poor.", [
        "image_quality",
      ]);
    }
    if (analysis.retake_guidance.length === 0) {
      issue("A retake result must include actionable guidance.", [
        "retake_guidance",
      ]);
    }
  } else if (analysis.retake_guidance.length > 0) {
    issue("Only a retake result may include retake guidance.", [
      "retake_guidance",
    ]);
  }

  const diagnosis = analysis.diagnosis;
  if (diagnosis) {
    // Low confidence with no proposed way to resolve it is the exact failure
    // this field exists to fix, so it is required rather than encouraged.
    if (diagnosis.confidence < 0.7 && diagnosis.next_measurement === null) {
      issue(
        "A diagnosis below 0.70 confidence must propose a next measurement.",
        ["diagnosis", "next_measurement"],
      );
    }
    // Every reason to scan a wall is a prelude to making a hole in it.
    if (
      diagnosis.next_measurement?.instrument === "wall_scanner" &&
      diagnosis.next_measurement.safety_note === null
    ) {
      issue("A wall-scanner measurement must carry a safety note.", [
        "diagnosis",
        "next_measurement",
        "safety_note",
      ]);
    }
  }
});

export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

export function parseAnalysis(value: unknown): Analysis {
  return AnalysisSchema.parse(value);
}

/**
 * Clears the arrays a given `result_type` forbids before strict validation.
 *
 * The model occasionally returns a complete diagnosis while still echoing the
 * follow-up questions the user just answered. Those questions carry no
 * information the client would ever render, but the cross-field rules treat the
 * combination as fatal — so a finished diagnosis was being thrown away right
 * after the user did the work of answering. Dropping the forbidden array keeps
 * the answer; every substantive rule (required fields, enums, ranges, and the
 * diagnosis/questions presence checks) still runs afterwards in `parseAnalysis`.
 */
export function normalizeAnalysis(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const analysis = { ...(value as Record<string, unknown>) };

  switch (analysis.result_type) {
    case "diagnosis":
      analysis.follow_up_questions = [];
      analysis.retake_guidance = [];
      break;
    case "questions":
      analysis.retake_guidance = [];
      analysis.diagnosis = null;
      break;
    case "retake":
      analysis.follow_up_questions = [];
      analysis.diagnosis = null;
      break;
    case "cannot_assess":
      analysis.follow_up_questions = [];
      analysis.retake_guidance = [];
      analysis.diagnosis = null;
      break;
    default:
      break;
  }

  return analysis;
}

const SAFETY_OVERRIDES: Partial<
  Record<(typeof PROFESSIONAL_TYPES)[number], string>
> = {
  electrician:
    "Electrical work can cause shock, fire, or death. Do not open energized equipment; use a licensed electrician.",
  gas_technician:
    "A suspected gas issue can cause fire, explosion, or poisoning. Leave the area if you smell gas and contact the gas utility or emergency services.",
  structural_engineer:
    "Possible structural movement cannot be cleared from a photo. Avoid loading or altering the area until a qualified professional evaluates it.",
};

export function applySafetyRules(analysis: Analysis): Analysis {
  const diagnosis = analysis.diagnosis;
  if (!diagnosis) return analysis;

  const professionalWarning = diagnosis.professional_type
    ? SAFETY_OVERRIDES[diagnosis.professional_type]
    : undefined;
  const urgentOverride =
    diagnosis.urgency === "urgent" || diagnosis.severity >= 9;

  if (!professionalWarning && !urgentOverride) return analysis;

  const warning =
    professionalWarning ??
    "This appears urgent. Avoid disturbing the area and arrange prompt professional assessment.";
  const safetyWarnings = diagnosis.safety_warnings.includes(warning)
    ? diagnosis.safety_warnings
    : [warning, ...diagnosis.safety_warnings];

  return {
    ...analysis,
    diagnosis: {
      ...diagnosis,
      safe_to_diy: false,
      needs_professional: true,
      disclaimer_required: true,
      recommendation: {
        ...diagnosis.recommendation,
        difficulty: "pro-only",
      },
      safety_warnings: safetyWarnings,
      // Sending someone to take a reading at a spot this response just declared
      // hazardous is a direct contradiction, and the safety override wins. This
      // runs after parseAnalysis, so clearing it cannot trip the low-confidence
      // rule that required it.
      next_measurement: null,
    },
  };
}

const generatedJsonSchema = z.toJSONSchema(BaseAnalysisSchema, {
  target: "draft-7",
});

// The API accepts the schema body but does not need the draft declaration.
const { $schema: _draft, ...analysisJsonSchema } = generatedJsonSchema;

type JsonSchemaNode = Record<string, unknown>;

// Structured outputs support only a subset of JSON Schema. Length, numeric-range
// and item-count constraints are rejected outright — the API answers 400
// ("For 'array' type, property 'maxItems' is not supported") and every scan fails.
// Zod emits them from .min()/.max(), so strip them here.
const UNSUPPORTED_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

// Values of these keywords are name -> schema maps, so their keys are property
// names rather than schema keywords and must not be filtered.
const SCHEMA_MAPS = new Set([
  "properties",
  "$defs",
  "definitions",
  "patternProperties",
]);

/**
 * Rewrites a Zod-generated schema into the subset the Messages API accepts.
 * Each dropped constraint is restated in `description` so the model still sees
 * the bound; Zod stays the real enforcer, since `parseAnalysis` rejects any
 * response that violates the original constraints.
 */
function toStructuredOutputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStructuredOutputSchema);
  if (node === null || typeof node !== "object") return node;

  const source = node as JsonSchemaNode;
  const result: JsonSchemaNode = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      dropped.push(`${key} ${JSON.stringify(value)}`);
      continue;
    }
    if (
      SCHEMA_MAPS.has(key) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = Object.fromEntries(
        Object.entries(value as JsonSchemaNode).map(([name, child]) => [
          name,
          toStructuredOutputSchema(child),
        ]),
      );
      continue;
    }
    result[key] = toStructuredOutputSchema(value);
  }

  if (dropped.length > 0) {
    const existing =
      typeof result.description === "string" ? `${result.description} ` : "";
    result.description = `${existing}Must satisfy: ${dropped.join(", ")}.`;
  }

  return result;
}

export const ANALYSIS_JSON_SCHEMA = toStructuredOutputSchema(
  analysisJsonSchema,
) as JsonSchemaNode;
