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
});

export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

export function parseAnalysis(value: unknown): Analysis {
  return AnalysisSchema.parse(value);
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
    },
  };
}

const generatedJsonSchema = z.toJSONSchema(BaseAnalysisSchema, {
  target: "draft-7",
});

// The API accepts the schema body but does not need the draft declaration.
const { $schema: _draft, ...analysisJsonSchema } = generatedJsonSchema;
export const ANALYSIS_JSON_SCHEMA = analysisJsonSchema;
