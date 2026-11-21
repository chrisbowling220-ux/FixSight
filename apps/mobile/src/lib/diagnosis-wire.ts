// Generated from src/diagnosis-wire.ts by npm run sync:contract. Do not edit.
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
    // Ordered, plain-language steps for the durable fix. Empty when the work is
    // not safe to do yourself — a professional's procedure is not a DIY guide.
    repair_steps: z.array(nonEmptyText(400)).max(12),
  })
  .strict();

export const CAUSE_LIKELIHOODS = ["most_likely", "possible", "less_likely"] as const;

/**
 * A candidate explanation, kept apart from what was actually seen. The photo
 * shows a stain; it does not show the roof leak that might have caused it.
 */
export const PossibleCauseSchema = z
  .object({
    cause: nonEmptyText(300),
    likelihood: z.enum(CAUSE_LIKELIHOODS),
    supporting_evidence: nonEmptyText(500),
  })
  .strict();

export const PriceRangeSchema = z
  .object({
    low: z.number().int().min(0).max(1_000_000),
    high: z.number().int().min(0).max(1_000_000),
  })
  .strict();

/**
 * Rough planning ranges, never a quote. Either range may be null when the
 * evidence cannot support one (unknown hidden damage, specialist-only work), and
 * the assumptions say what the figures depend on.
 */
export const CostEstimateSchema = z
  .object({
    currency: z.enum(["USD"]),
    diy_materials: PriceRangeSchema.nullable(),
    professional_total: PriceRangeSchema.nullable(),
    assumptions: z.array(nonEmptyText(300)).min(1).max(6),
  })
  .strict();

export const LaborEstimateSchema = z
  .object({
    hours_low: z.number().finite().min(0).max(1_000),
    hours_high: z.number().finite().min(0).max(1_000),
    who: nonEmptyText(120),
    assumptions: z.array(nonEmptyText(300)).min(1).max(6),
  })
  .strict();

export const FollowUpPlanSchema = z
  .object({
    reinspect_in_days: z.number().int().min(1).max(365),
    what_to_check: nonEmptyText(300),
  })
  .strict();

export const DiagnosisSchema = z
  .object({
    subject: nonEmptyText(300),
    diagnosis: nonEmptyText(1_000),
    // What is directly visible in the supplied photos — confirmed observations
    // only, never inferred mechanisms.
    observations: z.array(nonEmptyText(300)).min(1).max(8),
    likely_cause: nonEmptyText(2_000),
    possible_causes: z.array(PossibleCauseSchema).min(1).max(4),
    // What the photos cannot establish. Stated plainly so confidence is legible.
    limitations: z.array(nonEmptyText(300)).max(5),
    severity: z.number().int().min(0).max(10),
    urgency: z.enum(["cosmetic", "monitor", "soon", "urgent"]),
    confidence: z.number().finite().min(0).max(1),
    safe_to_diy: z.boolean(),
    diy_or_pro_reason: nonEmptyText(500),
    recommendation: RecommendationSchema,
    next_inspection_steps: z.array(nonEmptyText(300)).max(6),
    cost_estimate: CostEstimateSchema,
    labor_estimate: LaborEstimateSchema.nullable(),
    risk_if_ignored: nonEmptyText(2_000),
    needs_professional: z.boolean(),
    professional_type: z.enum(PROFESSIONAL_TYPES).nullable(),
    safety_warnings: z.array(nonEmptyText(500)).max(10),
    maintenance_tips: z.array(nonEmptyText(300)).max(5),
    follow_up: FollowUpPlanSchema.nullable(),
    additional_photos: z.array(nonEmptyText(300)).max(4),
    disclaimer_required: z.boolean(),
    next_measurement: NextMeasurementSchema.nullable(),
  })
  .strict();

export const BaseAnalysisSchema = z
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
    // Immediate-safety instructions that apply whatever the result type — a gas
    // smell mentioned in the description matters even when the photo is blurry.
    safety_notices: z.array(nonEmptyText(500)).max(6),
  })
  .strict();

/**
 * Records saved on a device before contract v5 lack the newer diagnosis fields.
 * Clients parse saved and received analyses with this tolerant schema, which
 * differs from the strict one only in allowing empty observation and cause
 * lists; `upgradeStoredAnalysis` supplies neutral defaults for missing fields.
 */
export const StoredDiagnosisSchema = DiagnosisSchema.extend({
  observations: z.array(nonEmptyText(300)).max(8),
  possible_causes: z.array(PossibleCauseSchema).max(4),
}).strict();

export const StoredAnalysisSchema = BaseAnalysisSchema.extend({
  diagnosis: StoredDiagnosisSchema.nullable(),
}).strict();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function upgradeStoredAnalysis(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const analysis: Record<string, unknown> = { safety_notices: [], ...value };
  const diagnosis = analysis.diagnosis;
  if (!isPlainRecord(diagnosis)) return analysis;

  const recommendation = isPlainRecord(diagnosis.recommendation)
    ? { repair_steps: [], ...diagnosis.recommendation }
    : diagnosis.recommendation;
  analysis.diagnosis = {
    observations: [],
    possible_causes: [],
    limitations: [],
    diy_or_pro_reason: diagnosis.needs_professional === true
      ? "A professional was recommended for this issue."
      : "Considered suitable for careful DIY with normal precautions.",
    next_inspection_steps: [],
    cost_estimate: {
      currency: "USD",
      diy_materials: null,
      professional_total: null,
      assumptions: ["No cost estimate was recorded for this earlier scan."],
    },
    labor_estimate: null,
    maintenance_tips: [],
    follow_up: null,
    additional_photos: [],
    next_measurement: null,
    ...diagnosis,
    recommendation,
  };
  return analysis;
}
