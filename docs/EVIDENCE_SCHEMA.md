# Multi-channel evidence — schema specification

**Status:** proposed, not implemented
**Targets:** `src/request-schema.ts`, `src/diagnosis-contract.ts`, `src/prompt.ts`
**Prompt version on landing:** `prompt_v2` → `prompt_v3`

---

## 1. What this changes and why

Today a scan is *n* visible photos plus free text. That forces the model to infer
from appearance alone, which is why the follow-up round exists at all: half the
questions it asks ("is it damp to the touch?", "does it change after rain?") are
proxies for measurements a $30 instrument answers directly and objectively.

This spec adds two things to the request:

- **`evidence[]`** — non-visible *images*: thermal frames, borescope shots from
  inside a cavity.
- **`readings[]`** — *numbers* from instruments: moisture, temperature, humidity.

and one thing to the response:

- **`next_measurement`** — which single instrument reading would most reduce
  uncertainty, and what result would mean what.

That last field is the point of the whole exercise. FixSight's advantage is not
owning sensors; it is knowing which measurement to ask for next and committing
in advance to how it will read the answer.

### Design constraint: additive only

`StoredScan.request` (`src/scans/types.ts:19`) is **persisted**. Reshaping
`images[]` into a discriminated union would invalidate every stored scan on
disk, and would break `image_count` (`types.ts:55`), the refinement replay in
`answerRequest()` (`src/scans/router.ts:181`), the legacy normalizer
(`request-schema.ts:64`), and `public/app.js`.

So `images[]` keeps its exact current meaning — **the visible-light channel** —
and the new fields sit beside it. Old requests stay valid, old stored scans stay
readable, and no existing caller changes.

### Where the JSON Schema subset applies

Only the **response** schema (`ANALYSIS_JSON_SCHEMA`) is sent to the Messages
API, so only it is restricted to the structured-outputs subset. The request
schema is validated server-side by Zod alone and may use anything Zod supports.

For the response, `toStructuredOutputSchema()` (`diagnosis-contract.ts:271`)
already strips the rejected keywords. Two rules when extending it:

- `anyOf`, `$ref`/`$defs`, and `enum` **are** supported — a discriminated union
  in the response is fine.
- Do **not** switch to the SDK's `zodOutputFormat` helper. It strips `enum` into
  a description string, which would silently destroy the `urgency`,
  `difficulty`, `professional_type`, and new `instrument` guarantees.

---

## 2. Request schema

Additions to `CanonicalAnalyzeRequestSchema` (`src/request-schema.ts:48`).

```ts
export const MAX_EVIDENCE = 4;
export const MAX_READINGS = 8;

// Visible photos plus evidence images share one budget. Each prepared image
// costs up to MAX_VISUAL_TOKENS (4,784) — see image-processing.ts — so this
// bounds worst-case input cost per scan rather than letting the two arrays
// multiply.
export const MAX_TOTAL_IMAGES = 6;

const EVIDENCE_KINDS = ["thermal", "cavity"] as const;

const EvidenceSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    // Same base64 validation as ImageInputSchema — extract the refinements into
    // a shared `base64Image()` helper rather than duplicating the three
    // .refine() calls.
    data: base64Image(),
    media_type: z.enum(SUPPORTED_MEDIA_TYPES),
    // Where on the subject this was taken, in the user's words. Lets the model
    // tie a thermal frame or cavity shot to a spot in the visible photo.
    location: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
```

### `kind` values

| Kind | What it is | Why it earns a slot |
|---|---|---|
| `thermal` | IR frame from a phone-attached or standalone thermal camera | A genuine second imaging channel. Shows temperature anomalies the visible photo cannot: wet insulation, missing insulation, air leaks, overheating connections |
| `cavity` | Borescope photo from inside a wall, ceiling, or floor void | The actual "x-ray". A real photograph of the thing itself — wet insulation, the corroded fitting, the direction staining runs |

Deliberately **not** included:

- **Wall-radar screenshots.** UWB scanners (Walabot DIY 2, Bosch D-tect) output
  *localization*, not imagery. A blob map answers "where is it safe to drill",
  which is a `next_measurement` instruction, not diagnostic evidence. Adding it
  as an image would spend ~4.8k visual tokens on a picture with no diagnosis in
  it.
- **Photos of a meter's LCD.** Tempting, but it puts OCR in front of a
  safety-relevant number. Readings are typed.

### Readings

```ts
const MOISTURE_SCALES = [
  "percent_wme",              // wood moisture equivalent, pin meters
  "percent_moisture_content", // %MC
  "relative_0_100",           // pinless meters' unitless relative scale
  "qualitative",              // no numeric meter: dry / damp / wet
] as const;

const MoistureReadingSchema = z
  .object({
    kind: z.literal("moisture"),
    scale: z.enum(MOISTURE_SCALES),
    value: z.number().finite().min(0).max(100).optional(),
    qualitative: z.enum(["dry", "damp", "wet", "saturated"]).optional(),
    location: z.string().trim().min(1).max(200),

    // A moisture number in isolation means very little: 16% is alarming in
    // drywall and unremarkable in framing lumber. Professionals always take a
    // control reading on the same material somewhere known-dry and compare.
    // These fields make that comparison possible; the prompt requires the model
    // to say so when they are absent.
    reference_value: z.number().finite().min(0).max(100).optional(),
    reference_location: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (r) => (r.scale === "qualitative" ? r.qualitative !== undefined : r.value !== undefined),
    { message: "Provide value for a numeric scale, or qualitative for the qualitative scale." },
  );

const TemperatureReadingSchema = z
  .object({
    kind: z.literal("temperature"),
    value: z.number().finite().min(-60).max(300),
    unit: z.enum(["f", "c"]),
    location: z.string().trim().min(1).max(200),
  })
  .strict();

// Ambient RH plus air temperature gives dew point, which is what separates
// condensation from a leak — a distinction FixSight currently cannot make.
const HumidityReadingSchema = z
  .object({
    kind: z.literal("humidity"),
    relative_humidity: z.number().finite().min(0).max(100),
    air_temperature: z.number().finite().min(-60).max(300).optional(),
    unit: z.enum(["f", "c"]).optional(),
    location: z.string().trim().min(1).max(200),
  })
  .strict();

const ReadingSchema = z.discriminatedUnion("kind", [
  MoistureReadingSchema,
  TemperatureReadingSchema,
  HumidityReadingSchema,
]);
```

### Assembled request

```ts
const CanonicalAnalyzeRequestSchema = z
  .object({
    images: z.array(ImageInputSchema).min(1).max(MAX_IMAGES),
    evidence: z.array(EvidenceSchema).max(MAX_EVIDENCE).default([]),
    readings: z.array(ReadingSchema).max(MAX_READINGS).default([]),
    category: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2_000).optional(),
    answers: z.array(AnswerSchema).max(3).default([]),
  })
  .strict()
  .refine((r) => r.images.length + r.evidence.length <= MAX_TOTAL_IMAGES, {
    message: "A scan may include at most 6 images in total.",
    path: ["evidence"],
  });
```

`normalizeLegacyRequest()` needs no change — `.default([])` covers every request
that omits the new fields, including all stored scans.

### Wire example

```jsonc
{
  "images": [
    { "data": "…", "media_type": "image/jpeg" }
  ],
  "evidence": [
    { "kind": "thermal", "data": "…", "media_type": "image/jpeg",
      "location": "same ceiling area, camera held at the doorway" }
  ],
  "readings": [
    { "kind": "moisture", "scale": "percent_wme", "value": 24.5,
      "location": "center of the stain",
      "reference_value": 9.0, "reference_location": "same ceiling, 6 ft away" },
    { "kind": "humidity", "relative_humidity": 68, "air_temperature": 71,
      "unit": "f", "location": "room center" }
  ],
  "category": "Ceiling & Walls",
  "description": "Stain got bigger after last week's rain.",
  "answers": []
}
```

---

## 3. Engine changes

`AnthropicDiagnosisEngine.analyze()` (`src/diagnosis-engine.ts:94`) builds one
content array. Evidence images append after the visible ones, and each gets a
text label immediately **before** it so the model knows what it is looking at —
an unlabeled thermal frame is worse than no thermal frame, because it looks like
a bizarre visible photo.

```ts
const content: Anthropic.Messages.ContentBlockParam[] = [
  ...visibleBlocks,                       // images[], unchanged
  ...request.evidence.flatMap((item, i) => [
    { type: "text", text: evidenceLabel(item, i) },   // "Thermal image 1 — <location>"
    imageBlock(preparedEvidence[i]),
  ]),
  { type: "text", text: contextText(request) },
];
```

`contextText()` (`diagnosis-engine.ts:37`) gains the readings, still explicitly
framed as untrusted evidence:

```ts
const context = {
  category: request.category ?? null,
  description: request.description ?? null,
  readings: request.readings,
  follow_up_answers: request.answers,
  answers_already_provided: request.answers.length > 0,
};
```

### Image preparation

`prepareImages()` (`src/image-processing.ts:180`) works unchanged for `cavity`
shots. **Thermal frames need one exception:** they are natively small (typically
256×192) and `targetDimensions()` will not enlarge them, which is correct — but
the JPEG re-encode at `quality: 90, chromaSubsampling: "4:4:4"` must be kept, not
lowered, because thermal palettes are pure chroma gradients and subsampling
destroys exactly the information being read. The current settings are already
right; add a test pinning them so nobody "optimizes" them later.

---

## 4. Response schema

Added to `DiagnosisSchema` (`src/diagnosis-contract.ts:37`):

```ts
const INSTRUMENTS = [
  "moisture_meter",
  "thermal_camera",
  "borescope",
  "wall_scanner",
  "hygrometer",
] as const;

export const NextMeasurementSchema = z
  .object({
    instrument: z.enum(INSTRUMENTS),
    target: nonEmptyText(300),          // exactly where to measure
    why: nonEmptyText(500),             // what it rules in or out
    // The field that makes the loop converge: the model must commit to how it
    // will read the result BEFORE seeing it. Without this it can rationalize
    // any reading into its existing hypothesis, and the extra measurement buys
    // nothing.
    expected_discriminator: nonEmptyText(500),
    safety_note: nonEmptyText(300).nullable(),
  })
  .strict();
```

added to `DiagnosisSchema` as `next_measurement: NextMeasurementSchema.nullable()`.

`expected_discriminator` is written like: *"Above roughly 20% WME with a dry
reference near 9% indicates active water entry and points to the roof; readings
within a few points of the reference indicate an old stain from a leak already
repaired."*

### Cross-field rules

Extend the `superRefine` block (`diagnosis-contract.ts:71`):

- `next_measurement` may be non-null only when `result_type` is `"diagnosis"`.
  On `questions` and `retake` the response already tells the user what to do
  next; a second competing instruction is confusing.
- When `confidence < 0.70` on a diagnosis, `next_measurement` **must** be
  non-null. Low confidence with no proposed way to resolve it is the failure
  mode this whole feature exists to fix.
- `instrument: "wall_scanner"` requires a non-null `safety_note` — every reason
  to scan a wall is a prelude to making a hole in it.

### normalizeAnalysis

Add `next_measurement = null` to the `questions`, `retake`, and `cannot_assess`
branches of `normalizeAnalysis()` (`diagnosis-contract.ts:150`), matching how the
existing forbidden arrays are cleared. Same reasoning as before: a stray field
the client would never render must not destroy an otherwise valid diagnosis.

### applySafetyRules

`applySafetyRules()` (`diagnosis-contract.ts:192`) must **suppress**
`next_measurement` whenever it forces `pro-only` for electrical, gas, or
structural. Telling someone to go take a reading at a spot the same response
just declared hazardous is a direct contradiction, and the safety override has
to win.

---

## 5. Prompt changes (`src/prompt.ts`)

The existing EVIDENCE AND HONESTY paragraph (`prompt.ts:19`) forbids claiming to
"measure moisture" or "see behind a wall". Those prohibitions were correct when
photos were the only input and are now **too broad** — but they must be
*narrowed per channel*, not deleted. A new section:

> **INSTRUMENT EVIDENCE**
>
> Some scans include readings and additional imaging channels. Each has strict
> limits:
>
> **Thermal images** show apparent surface temperature, not moisture, and not
> what is behind the surface. A cool region is equally consistent with
> evaporative cooling from water, an air leak, missing insulation, or a cold
> water line. Never state that thermal imaging shows water. Say what the thermal
> anomaly is and give the competing explanations. Thermal images are not
> calibrated: treat only relative differences as meaningful, never absolute
> temperatures, unless a separate temperature reading is supplied.
>
> **Moisture readings** describe one point on one material at one moment. Scales
> differ between meters, and the same number means different things in drywall,
> plaster, and framing lumber. A reading without a dry reference on the same
> material is weak evidence — say so and keep confidence low. Never extrapolate
> one reading to an area you cannot see.
>
> **Cavity images** are real photographs and may be read as directly as visible
> photos, but they show only what the borescope was pointed at. Do not
> generalize from one cavity to the rest of the assembly.
>
> **Humidity and temperature** together indicate whether surface condensation is
> plausible. Where condensation explains the evidence as well as a leak does,
> say both and do not pick one on the strength of the photo alone.
>
> When readings and photographs disagree, lower confidence and state the
> conflict. Never revise a measurement to fit an appearance.

And for the new output field:

> **NEXT MEASUREMENT**
>
> On a diagnosis, propose the single measurement that would most reduce your
> uncertainty, or null if the evidence is already conclusive. Name one
> instrument, one specific place to use it, and — before knowing the result —
> state what outcome would support which explanation. If confidence is below
> 0.70 you must propose one. Never propose a measurement that requires entering
> a space, contacting anything energized, working at height, or disturbing
> suspected asbestos, lead paint, or mold.

---

## 6. Storage and client

- `PublicScan` (`src/scans/types.ts:30`) gains `evidence_count` and
  `reading_count`. Do not surface raw readings to the list view; the diagnosis
  already narrates them.
- `answerRequest()` (`src/scans/router.ts:181`) replays the stored request into
  the refinement leg. It must forward `evidence` and `readings` alongside
  `images`, or the second call silently loses every instrument input — the same
  class of bug as the lost-diagnosis defect.
- `buildScanReport()` (`src/scans/report.ts`) should list readings verbatim with
  their locations. A contractor reading the report needs the raw numbers.
- Clients (`public/app.js`, `apps/mobile`) need no change to keep working. New
  capture UI is a separate piece of work.

---

## 7. Rollout

1. `base64Image()` extraction + `evidence`/`readings` on the request schema, with
   tests. No behavior change yet — the fields are accepted and ignored.
2. Engine wiring: labeled evidence blocks, readings in context, `prompt_v3`.
3. `next_measurement` on the response, cross-field rules, `normalizeAnalysis`
   and `applySafetyRules` updates.
4. Report and `PublicScan` counts; forward evidence through the refinement leg.
5. Client capture UI — share-sheet intake for thermal/cavity images and a
   numeric entry sheet for readings.

Steps 1–4 are server-only and independently shippable. Step 5 is where the
device story lands, and it deliberately never talks to sensor hardware: every
one of these instruments already exports a JPEG or shows a number on a screen,
so accepting a shared image and a typed value works with every brand and needs
no vendor SDK.

## 8. Cost

Each additional image costs up to `MAX_VISUAL_TOKENS` (4,784) visual tokens
(`image-processing.ts:12`). Thermal frames are small enough to land well under
that; cavity shots will hit the cap. At Opus 5 rates a six-image scan runs
roughly 2× the input cost of a single-image scan — but it should eliminate the
follow-up round in most cases, and that round is a *whole second call*. The
expected net is neutral to cheaper, with a faster answer. Instrument the token
counts already captured in `AnalysisMetadata` before and after to confirm rather
than assume.
