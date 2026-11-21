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
  })
  .strict();

