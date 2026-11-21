import { z } from "zod";
import { BaseAnalysisSchema, DiagnosisSchema, FollowUpQuestionSchema, PROFESSIONAL_TYPES } from "./diagnosis-wire.js";
import { detectInputHazards, detectOutputHazards, type HazardMatch } from "./safety.js";
export {
  BaseAnalysisSchema,
  CostEstimateSchema,
  DiagnosisSchema,
  FollowUpQuestionSchema,
  INSTRUMENTS,
  LaborEstimateSchema,
  NextMeasurementSchema,
  PossibleCauseSchema,
  PROFESSIONAL_TYPES,
  RecommendationSchema,
  StoredAnalysisSchema,
  upgradeStoredAnalysis,
} from "./diagnosis-wire.js";

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
    // Exempt hazardous professional-only work: the prompt forbids measurements
    // near energized, gas, or structurally unsafe areas, and the safety layer
    // clears any it receives, so requiring one would reject a correct answer.
    const hazardousReferral =
      diagnosis.recommendation.difficulty === "pro-only" &&
      diagnosis.professional_type !== null &&
      ["electrician", "gas_technician", "structural_engineer", "foundation_specialist"].includes(
        diagnosis.professional_type,
      );
    if (diagnosis.confidence < 0.7 && diagnosis.next_measurement === null && !hazardousReferral) {
      issue(
        "A diagnosis below 0.70 confidence must propose a next measurement.",
        ["diagnosis", "next_measurement"],
      );
    }
    for (const [key, range] of [
      ["diy_materials", diagnosis.cost_estimate.diy_materials],
      ["professional_total", diagnosis.cost_estimate.professional_total],
    ] as const) {
      if (range && range.low > range.high) {
        issue("A cost range must not have its low end above its high end.", [
          "diagnosis",
          "cost_estimate",
          key,
        ]);
      }
    }
    if (
      diagnosis.labor_estimate &&
      diagnosis.labor_estimate.hours_low > diagnosis.labor_estimate.hours_high
    ) {
      issue("A labor range must not have its low end above its high end.", [
        "diagnosis",
        "labor_estimate",
      ]);
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

  if (analysis.result_type === "diagnosis") {
    analysis.diagnosis = normalizeDiagnosis(analysis.diagnosis);
  }
  return analysis;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function orderedRange(value: unknown, lowKey: string, highKey: string): unknown {
  if (!isRecord(value)) return value;
  const low = value[lowKey];
  const high = value[highKey];
  if (typeof low === "number" && typeof high === "number" && low > high) {
    return { ...value, [lowKey]: high, [highKey]: low };
  }
  return value;
}

/**
 * Repairs mechanical slips that would otherwise discard a paid, otherwise valid
 * diagnosis: a reversed range, or a referral that forgot to name the trade.
 * Nothing substantive is invented — the substitutes are the neutral values.
 */
function normalizeDiagnosis(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const diagnosis = { ...value };
  if (diagnosis.needs_professional === true && diagnosis.professional_type === null) {
    diagnosis.professional_type = "other";
  }
  if (isRecord(diagnosis.cost_estimate)) {
    diagnosis.cost_estimate = {
      ...diagnosis.cost_estimate,
      diy_materials: orderedRange(diagnosis.cost_estimate.diy_materials, "low", "high"),
      professional_total: orderedRange(diagnosis.cost_estimate.professional_total, "low", "high"),
    };
  }
  diagnosis.labor_estimate = orderedRange(diagnosis.labor_estimate, "hours_low", "hours_high");
  return diagnosis;
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

export interface SafetyContext {
  /** The user's free-text description. */
  description?: string | undefined;
  /** The user's follow-up answers, verbatim. */
  answers?: readonly string[] | undefined;
}

const MAX_SAFETY_NOTICES = 6;
const MAX_SAFETY_WARNINGS = 10;

function mergeUnique(first: readonly string[], second: readonly string[], limit: number): string[] {
  const merged: string[] = [];
  for (const item of [...first, ...second]) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged.slice(0, limit);
}

/**
 * Advice the result itself says is not DIY-safe must not ship with DIY steps,
 * a DIY shopping list, or a DIY materials price — the combination reads as
 * permission. Also used after a safety override has flipped safe_to_diy.
 */
function enforceDiyConsistency(diagnosis: Diagnosis): Diagnosis {
  if (diagnosis.safe_to_diy) return diagnosis;
  return {
    ...diagnosis,
    recommendation: {
      ...diagnosis.recommendation,
      repair_steps: [],
      tools_or_parts: [],
    },
    cost_estimate: {
      ...diagnosis.cost_estimate,
      diy_materials: null,
    },
  };
}

function professionalOverride(diagnosis: Diagnosis, warnings: readonly string[]): Diagnosis {
  return enforceDiyConsistency({
    ...diagnosis,
    safe_to_diy: false,
    needs_professional: true,
    professional_type: diagnosis.professional_type ?? "other",
    disclaimer_required: true,
    recommendation: {
      ...diagnosis.recommendation,
      difficulty: "pro-only",
    },
    safety_warnings: mergeUnique(warnings, diagnosis.safety_warnings, MAX_SAFETY_WARNINGS),
    // Sending someone to take a reading at a spot this response just declared
    // hazardous is a direct contradiction, and the safety override wins. This
    // runs after parseAnalysis, so clearing it cannot trip the low-confidence
    // rule that required it.
    next_measurement: null,
  });
}

function outputHazards(diagnosis: Diagnosis): HazardMatch[] {
  return detectOutputHazards(
    diagnosis.subject,
    diagnosis.diagnosis,
    diagnosis.likely_cause,
    ...diagnosis.observations,
  );
}

/**
 * Deterministic safety layer applied to every validated analysis.
 *
 * 1. Hazards in the user's own words become top-level safety notices on any
 *    result type, so a gas smell is addressed even when the photo is unusable.
 * 2. A diagnosis is forced to professional-only handling when the model chose
 *    a hazardous professional type, rated it urgent, described a hazard in its
 *    own findings, or the user described one.
 * 3. A diagnosis that is not DIY-safe never carries DIY steps or DIY costs.
 */
export function applySafetyRules(analysis: Analysis, context: SafetyContext = {}): Analysis {
  const inputHazards = detectInputHazards(context.description, ...(context.answers ?? []));
  const safetyNotices = mergeUnique(
    analysis.safety_notices,
    inputHazards.map((hazard) => hazard.notice),
    MAX_SAFETY_NOTICES,
  );

  const diagnosis = analysis.diagnosis;
  if (!diagnosis) {
    return { ...analysis, safety_notices: safetyNotices };
  }

  const professionalWarning = diagnosis.professional_type
    ? SAFETY_OVERRIDES[diagnosis.professional_type]
    : undefined;
  const urgentOverride =
    diagnosis.urgency === "urgent" || diagnosis.severity >= 9;
  const hazards = [...inputHazards, ...outputHazards(diagnosis)];
  const forcingHazards = hazards.filter((hazard) => hazard.forcesProfessional);
  const advisoryWarnings = hazards
    .filter((hazard) => !hazard.forcesProfessional)
    .map((hazard) => hazard.warning);

  const overrideWarnings = mergeUnique(
    [
      ...(professionalWarning ? [professionalWarning] : []),
      ...forcingHazards.map((hazard) => hazard.warning),
    ],
    [],
    MAX_SAFETY_WARNINGS,
  );
  if (overrideWarnings.length === 0 && urgentOverride) {
    overrideWarnings.push(
      "This appears urgent. Avoid disturbing the area and arrange prompt professional assessment.",
    );
  }

  let next: Diagnosis = {
    ...diagnosis,
    safety_warnings: mergeUnique(diagnosis.safety_warnings, advisoryWarnings, MAX_SAFETY_WARNINGS),
  };
  next = overrideWarnings.length > 0
    ? professionalOverride(next, overrideWarnings)
    : enforceDiyConsistency(next);

  return { ...analysis, safety_notices: safetyNotices, diagnosis: next };
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
