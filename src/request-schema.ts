import { z } from "zod";

export const MAX_IMAGES = 4;
export const MAX_EVIDENCE = 4;
export const MAX_READINGS = 8;

// Visible photos and evidence images share one budget. Each prepared image costs
// up to MAX_VISUAL_TOKENS (4,784) — see image-processing.ts — so this bounds the
// worst-case input cost of a scan instead of letting the two arrays multiply.
export const MAX_TOTAL_IMAGES = 6;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const EVIDENCE_KINDS = ["thermal", "cavity"] as const;

export const MOISTURE_SCALES = [
  "percent_wme", // wood moisture equivalent, typical of pin meters
  "percent_moisture_content",
  "relative_0_100", // pinless meters' unitless relative scale
  "qualitative", // no numeric meter available
] as const;

// A single greedy character-class loop with the padding pinned to the end.
// The previous `(?:[A-Za-z0-9+/]{4})*` form pushed a backtracking frame per
// group repetition and threw `RangeError: Maximum call stack size exceeded`
// on multi-megabyte photos — i.e. on exactly the images a phone camera sends.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

// Four base64 characters encode three bytes, so this bounds the decoded size
// without allocating a Buffer for an image we are about to reject anyway.
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

function base64Image() {
  return z
    .string()
    .min(1)
    .refine((value) => value.length <= MAX_BASE64_LENGTH, {
      message: "Each image must be 10 MiB or smaller.",
    })
    .refine((value) => value.length % 4 === 0 && BASE64_PATTERN.test(value), {
      message: "Image data must be raw, padded base64.",
    })
    .refine((value) => Buffer.byteLength(value, "base64") <= MAX_IMAGE_BYTES, {
      message: "Each image must be 10 MiB or smaller.",
    });
}

const ImageInputSchema = z
  .object({
    data: base64Image(),
    media_type: z.enum(SUPPORTED_MEDIA_TYPES),
  })
  .strict();

/**
 * A non-visible imaging channel: a thermal frame or a borescope shot from inside
 * a cavity. Wall-radar output is deliberately absent — a UWB scanner reports
 * where objects are, not what is wrong, so it belongs in `next_measurement`
 * guidance rather than in the evidence a diagnosis is drawn from.
 */
const EvidenceSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    data: base64Image(),
    media_type: z.enum(SUPPORTED_MEDIA_TYPES),
    // Ties the frame to a spot in the visible photo, in the user's own words.
    location: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const MoistureReadingSchema = z
  .object({
    kind: z.literal("moisture"),
    scale: z.enum(MOISTURE_SCALES),
    value: z.number().finite().min(0).max(100).optional(),
    qualitative: z.enum(["dry", "damp", "wet", "saturated"]).optional(),
    location: z.string().trim().min(1).max(200),

    // A moisture number alone means little: 16% is alarming in drywall and
    // unremarkable in framing lumber. Professionals always take a control
    // reading on the same material somewhere known-dry and compare against it.
    reference_value: z.number().finite().min(0).max(100).optional(),
    reference_location: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const TemperatureReadingSchema = z
  .object({
    kind: z.literal("temperature"),
    value: z.number().finite().min(-60).max(300),
    unit: z.enum(["f", "c"]),
    location: z.string().trim().min(1).max(200),
  })
  .strict();

// Relative humidity with an air temperature yields a dew point, which is what
// separates surface condensation from a leak.
const HumidityReadingSchema = z
  .object({
    kind: z.literal("humidity"),
    relative_humidity: z.number().finite().min(0).max(100),
    air_temperature: z.number().finite().min(-60).max(300).optional(),
    unit: z.enum(["f", "c"]).optional(),
    location: z.string().trim().min(1).max(200),
  })
  .strict();

// Every member stays a plain object. Wrapping one in .refine() turns it into an
// effects schema, and inferring the union through the enclosing request type
// then costs enough to exhaust the compiler's heap — so the one cross-field
// moisture rule lives in the request-level superRefine below instead.
const ReadingSchema = z.discriminatedUnion("kind", [
  MoistureReadingSchema,
  TemperatureReadingSchema,
  HumidityReadingSchema,
]);

const AnswerSchema = z
  .object({
    question_id: z.string().trim().min(1).max(100),
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(1_000),
  })
  .strict();

const CanonicalAnalyzeRequestSchema = z
  .object({
    images: z.array(ImageInputSchema).min(1).max(MAX_IMAGES),
    evidence: z.array(EvidenceSchema).max(MAX_EVIDENCE).default([]),
    readings: z.array(ReadingSchema).max(MAX_READINGS).default([]),
    category: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2_000).optional(),
    answers: z.array(AnswerSchema).max(3).default([]),
    vision_mode: z.enum(["thermal", "cold", "wet", "xray"]).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.images.length + request.evidence.length > MAX_TOTAL_IMAGES) {
      context.addIssue({
        code: "custom",
        message: `A scan may include at most ${MAX_TOTAL_IMAGES} images in total.`,
        path: ["evidence"],
      });
    }

    request.readings.forEach((reading, index) => {
      if (reading.kind !== "moisture") return;
      const supplied =
        reading.scale === "qualitative"
          ? reading.qualitative !== undefined
          : reading.value !== undefined;
      if (!supplied) {
        context.addIssue({
          code: "custom",
          message:
            "Provide value for a numeric scale, or qualitative for the qualitative scale.",
          path: ["readings", index],
        });
      }
    });
  });

export type AnalyzeRequest = z.infer<typeof CanonicalAnalyzeRequestSchema>;
export type ImageInput = AnalyzeRequest["images"][number];
export type EvidenceInput = AnalyzeRequest["evidence"][number];
export type Reading = AnalyzeRequest["readings"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLegacyRequest(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const hasLegacyImage = "image" in value || "mediaType" in value;
  if (!hasLegacyImage) return value;

  const qa = Array.isArray(value.qa) ? value.qa : [];
  const answers = qa.map((item, index) => {
    if (!isRecord(item)) return item;
    return {
      question_id: `legacy-${index + 1}`,
      question: item.question,
      answer: item.answer,
    };
  });

  const normalized: Record<string, unknown> = {
    images: [{ data: value.image, media_type: value.mediaType }],
    answers,
  };
  if ("category" in value) normalized.category = value.category;
  if ("description" in value) normalized.description = value.description;
  if ("vision_mode" in value) normalized.vision_mode = value.vision_mode;
  return normalized;
}

export function parseAnalyzeRequest(value: unknown): AnalyzeRequest {
  if (!isRecord(value)) {
    return CanonicalAnalyzeRequestSchema.parse(value);
  }
  return CanonicalAnalyzeRequestSchema.parse(normalizeLegacyRequest(value));
}
