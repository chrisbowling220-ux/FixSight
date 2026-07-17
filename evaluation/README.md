# Phase 0 photo evaluation

This harness repeatedly sends a local set of photos to FixSight and checks the trust and safety fields that matter most: assessment type, image quality, severity, confidence, and professional escalation.

## Set up a case set

Copy `cases.example.json` to `cases.json`, create `evaluation/photos`, and replace the placeholder images with photos you are permitted to use. Image paths are resolved relative to the JSON file, not the shell's working directory. A case may include one image or several.

Each image can be a path string. JPEG, PNG, and WebP media types are inferred from the extension. Use an object when a file has a different extension or needs an explicit media type:

```json
{
  "path": "./photos/crack.bin",
  "media_type": "image/jpeg"
}
```

The checked-in example is a template and will not run until its placeholder photo paths exist.

## Run it

Start the FixSight server, then run the evaluator with a TypeScript runtime:

```powershell
npx tsx scripts/evaluate.ts
```

The default case file is `evaluation/cases.json`. Pass another JSON file as the only argument when needed:

```powershell
npx tsx scripts/evaluate.ts evaluation/cases.example.json
```

The evaluator calls `http://localhost:3000/api/analyze` by default. Override the server or per-request timeout with environment variables:

```powershell
$env:FIXSIGHT_BASE_URL = "http://localhost:4000"
$env:FIXSIGHT_TIMEOUT_MS = "180000"
npx tsx scripts/evaluate.ts evaluation/cases.json
```

Requests run sequentially to keep logs readable and reduce rate-limit noise. Every request has this shape:

```json
{
  "images": [
    { "data": "<base64>", "media_type": "image/jpeg" }
  ],
  "category": "drywall crack",
  "description": "It appeared recently."
}
```

## Case format

The top level contains a `cases` array. Every case needs at least one `images` entry and an `expect` object. `id` or `name` supplies the label in the report.

Supported expectations:

| Key | Meaning |
| --- | --- |
| `allowed_result_types` | Non-empty list of acceptable `result_type` strings. |
| `min_severity` / `max_severity` | Inclusive severity limits from 0 through 10. The scorer also recognizes the legacy name `severity_score`. |
| `min_confidence` / `max_confidence` | Inclusive numeric confidence limits from 0 through 1. |
| `needs_professional` | Exact boolean match. |
| `professional_type` | Exact string or `null`; use an array to allow several exact labels. |
| `image_quality` | Exact `good`, `usable`, or `poor`; use an array to allow several values. |

Only configured expectations are scored. An empty `expect` object therefore checks just that the endpoint returns a successful JSON object. Scored fields may be returned at the response root or inside common wrappers such as `diagnosis`, `analysis`, `result`, or `data`.

Each case prints `PASS` or `FAIL`, elapsed time, the returned scoring fields, and any failed assertions. The process exits with status `1` if a case fails, the server returns an error, an image cannot be read, or the case configuration is invalid. This makes the command suitable for local regression checks and CI once a stable, licensed photo corpus is available.
