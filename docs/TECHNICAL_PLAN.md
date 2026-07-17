# FixSight — Technical Plan (v1)

**Status:** Prototype built; production architecture still ahead.
**Target production platform:** React Native (Expo, TypeScript).
**Core capability at launch:** phone-camera photo → AI visual diagnosis → structured, trustworthy result.
**Last updated:** 2026-07-15

---

## 0. Where we actually are (read this first)

This plan was written day-one as the target *production* architecture. Since then we
built a **working web prototype** to prove the concept fast, and the user chose the web
prototype over starting straight in Expo. So the current reality differs from the plan
below in a few concrete ways — the plan is still the destination, the prototype is the
first step toward it:

| Topic | Plan (production target) | Prototype (built, running today) |
|---|---|---|
| Frontend | Expo / React Native / TypeScript | Mobile-first **web app**, vanilla JS in `public/` |
| Backend | Node + TS, serverless host, auth, image store | Node + **Express (JS)**, `server.js`, no auth, no persistence |
| Local storage | expo-sqlite | Browser **localStorage** (last 20 scans) |
| Image resize | server-side toward 2576px | **client-side to 1568px** before upload |
| Follow-up loop | up to ~2 rounds | **1 round** (model asks ≤3 questions, then commits) |
| Schema | §4.2 shape (`subject`, `image_quality`, `confidence` 0–1, …) | equivalent but flatter shape in `server.js` (`result_type`, `severity_score` 1–10, `confidence` low/med/high, `share_summary`) — see §4.2 note |
| Model / SDK | `claude-opus-4-8`, official `@anthropic-ai/sdk` | ✅ same — this carried over exactly |

**What carried over unchanged and is proven:** the thin-backend-holds-the-key rule, the
official SDK, `claude-opus-4-8` with adaptive thinking + structured outputs, the
confidence + "get a pro" trust spine, and the safety bias for electrical/gas/structural.
Everything below is the roadmap for turning the prototype into the production app;
Phase 0 (§9) is effectively **done** — the prototype *is* the proof of the engine.

---

## 1. Guiding principles

1. **Start narrow, be accurate.** Ship a small set of high-value use cases (windows/doors, ceiling stains, drywall cracks, flooring, water intrusion, visible exterior damage) and be right often enough that people trust the app. Breadth is a v2+ problem.
2. **Honesty is a feature.** Every diagnosis carries a **confidence score** and a **"get a professional" escape hatch**. The app is allowed — encouraged — to say *"I'm not sure, and here's why."* That's what makes the confident answers believable.
3. **Never ship the AI key in the app.** All model calls go through our own backend. The mobile app never sees `ANTHROPIC_API_KEY`.
4. **Hardware is a roadmap, not a blocker.** Thermal and in-wall sensing (v2/v3) are stubbed as "coming soon" so the architecture is ready, but v1 is 100% ordinary camera.
5. **Structured, not free-text.** The model returns a strict JSON schema, not prose. The app renders a card from typed fields — predictable UI, easy to store, easy to trend over time.

---

## 2. Architecture overview

```
┌─────────────────────────────┐        ┌───────────────────────────────┐
│  Expo app (React Native)    │        │  FixSight backend (our server) │
│                             │  HTTPS │                               │
│  • Camera capture           │ ─────▶ │  • Auth (session/JWT)         │
│  • Follow-up Q&A UI         │        │  • Holds ANTHROPIC_API_KEY    │
│  • Diagnosis card           │ ◀───── │  • Builds the diagnostic call │
│  • Local scan history       │  JSON  │  • Calls Claude (vision)      │
│  • Auth screen              │        │  • Validates + returns JSON   │
└─────────────────────────────┘        └───────────────┬───────────────┘
                                                        │
                                              ┌─────────▼──────────┐
                                              │  Claude Messages    │
                                              │  API (vision +      │
                                              │  structured output) │
                                              └─────────────────────┘
        │                                               │
        ▼                                               ▼
   Device storage / cloud DB                     Image storage (S3/R2)
   (scans, history, before/after)                (originals + thumbnails)
```

**Why the backend exists (non-negotiable):** an API key shipped inside a mobile binary can be extracted in minutes. The backend is the only thing that holds the key, and it's also where we enforce auth, rate limits, prompt/versioning control, and abuse protection. It stays thin: receive image + context → call Claude → validate → return.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Expo (React Native) + TypeScript** | Real native camera, app-store path, one codebase for iOS/Android; needed for thermal/hardware attachments later. |
| Camera | **expo-camera** | First-party, well-supported photo capture. |
| Local storage | **expo-sqlite** (or WatermelonDB if it grows) | Scan history, before/after, offline-first. |
| Navigation | **expo-router** | File-based routing, deep links for shared reports. |
| State/data | **TanStack Query** | Handles the async scan request, retries, caching. |
| Backend | **Node + TypeScript** (Express or Hono) on a serverless host (Vercel/Cloudflare Workers/Fly) | Same language as the app; easy to host the thin proxy. |
| AI | **Anthropic Claude Messages API** (`@anthropic-ai/sdk`) | Vision + structured output in one call. |
| Image storage | **S3 / Cloudflare R2** | Store originals for history + before/after; send to model as base64 or via the Files API. |
| Auth | **Clerk / Supabase Auth / Firebase Auth** | Don't roll our own. |

> The AI layer is written **only** with the official `@anthropic-ai/sdk` on the backend — never raw `fetch` against the API, and never from the app.

---

## 4. The AI diagnosis engine (the heart of the product)

Everything else is plumbing. This is the product.

### 4.1 Model choice

**Default: `claude-opus-4-8`.**
- First-class **high-resolution vision** (up to 2576px on the long edge) — critical for spotting cracks, seal failure, stains, corrosion, hairline damage. Coordinates map 1:1 to pixels if we ever draw callouts on the image.
- Strong at the visual self-verification this task needs (looking carefully, then reasoning about cause).
- **Adaptive thinking** so it reasons before committing to a diagnosis: `thinking: { type: "adaptive" }`, `output_config: { effort: "high" }`.

**Cost-optimized alternative for scale: `claude-sonnet-5`.** Also has high-res vision (2576px) at roughly half the price. Plan: build on Opus 4.8 for quality during v1, keep the model ID a single config value, and A/B Sonnet 5 once we have real accuracy data. **Never downgrade silently** — it's a measured decision, not a default.

### 4.2 Structured output — the diagnosis schema

We constrain the model to a strict JSON schema via `output_config.format` (or `client.messages.parse()` with a Zod schema). No prose parsing, ever. Proposed v1 schema:

```jsonc
{
  "subject": "string",              // what the app thinks it's looking at, e.g. "exterior window frame"
  "image_quality": "good | usable | poor",   // if poor, we ask for a re-shoot instead of guessing
  "diagnosis": "string",            // the likely problem, plain language
  "likely_cause": "string",         // why it probably happened
  "severity": 0,                    // 0–10 integer
  "urgency": "cosmetic | monitor | soon | urgent",
  "confidence": 0.0,                // 0.0–1.0 — surfaced in the UI
  "safe_to_diy": true,              // boolean
  "recommendation": {
    "best_fix": "string",
    "cheap_or_temp_fix": "string",
    "tools_or_parts": ["string"],
    "difficulty": "easy | moderate | hard | pro-only"
  },
  "risk_if_ignored": "string",
  "needs_professional": true,       // the escape hatch
  "professional_type": "string | null",   // e.g. "roofer", "licensed electrician"
  "follow_up_questions": [          // 0–3 questions to raise confidence
    { "id": "string", "question": "string", "why_it_matters": "string" }
  ],
  "disclaimer_required": true
}
```

Notes:
- `image_quality: "poor"` short-circuits into a **"retake the photo"** flow instead of a low-quality guess. This single field prevents a whole class of confidently-wrong answers.
- `confidence`, `needs_professional`, and `professional_type` are the trust spine of the product (see §8).
- `follow_up_questions` drives the Q&A loop below.

> **Prototype schema note (built).** `server.js` implements an equivalent but flatter
> version of this schema, tuned for the web card. The differences to reconcile when we
> move to production: `result_type` (`questions | diagnosis | cannot_assess`) replaces the
> separate `image_quality`/questions branching; `confidence` is an enum (`low|medium|high`)
> rather than a 0–1 float; `severity_score` is 1–10 with a paired `severity_label`;
> `diy_or_pro` is a 4-value enum instead of separate `safe_to_diy` + `needs_professional`
> booleans; and there's a `share_summary` field (plain-text report for a contractor/
> landlord/insurer) that this original schema didn't have. **Before production, pick one
> canonical schema** — the flatter enum-based one has proven nicer to render; the richer
> one here has `image_quality` re-shoot and `professional_type` that are worth keeping.
> Per the non-negotiable, there must end up being exactly one shared definition.

### 4.3 The follow-up-question loop

Real diagnosis needs context a photo can't give (building age, indoor/outdoor, how long it's been there, is it spreading). The flow:

1. **First call:** image + minimal known context → model returns a diagnosis *and* up to 3 `follow_up_questions`.
2. If confidence is high and no questions → show the card immediately.
3. If questions exist → app renders them as quick chips/toggles. User answers.
4. **Second call:** original image + answers appended as text → model returns the refined, higher-confidence diagnosis (usually with `follow_up_questions: []`).

This is a stateless multi-turn conversation: we resend the image + the growing context each call. Cap at ~2 rounds to control latency and cost.

### 4.4 Multi-image support (build in from v1)

The schema and API call accept **multiple images** in one message (e.g. a wide shot + a close-up, or before/after). Even if the v1 UI only sends one, keep the request shape a list so we don't refactor later.

### 4.5 Prompt strategy

- A large, **stable system prompt** encodes the diagnostic persona, the use-case scope, the "say when unsure" rule, the severity rubric, and the output contract. Because it's stable, we put a **prompt-caching breakpoint** on it → ~90% cheaper input tokens on every call after the first, and lower latency.
- Per-request content (the image + user context) goes *after* the cached prefix so it never invalidates the cache.
- The system prompt is **versioned** (e.g. `prompt_v3`) and stored server-side so we can iterate without shipping an app update, and so a saved scan records which prompt produced it.

### 4.6 Streaming vs. not

v1 diagnosis output is small (< 1k tokens) → a single non-streaming call with a spinner is fine. If we later show the reasoning live ("checking the seal… checking the frame…"), switch to streaming with `display: "summarized"` thinking.

---

## 5. Data model (v1)

```
User        ── id, auth_provider_id, created_at
Property    ── id, user_id, label ("Home", "Rental #2"), type, year_built?, location?
Scan        ── id, user_id, property_id?, created_at,
               image_urls[], thumbnail_url,
               model_id, prompt_version,
               diagnosis_json (the full schema above),
               user_context_json (follow-up answers),
               status (draft | complete),
               resolved (bool), resolution_note?
ScanEvent   ── id, scan_id, kind (created | followup | reinspection | resolved), created_at
```

- **Before/after & maintenance history** fall out naturally: link scans by `property_id`, or a `reinspection` scan references a prior `scan_id`.
- **Report export** (send to contractor / landlord / insurance) is a render of one or more `Scan.diagnosis_json` records to PDF/share link — a pure formatting job, no new model call.

---

## 6. Backend design (thin proxy)

Endpoints (all authenticated):

- `POST /scans` — multipart image(s) + optional context → runs the first diagnosis call → returns `{ scan_id, diagnosis }`.
- `POST /scans/:id/answers` — follow-up answers → runs the refinement call → returns updated `diagnosis`.
- `GET /scans` / `GET /scans/:id` — history.
- `POST /scans/:id/report` — generate a shareable report (PDF/link).

Backend responsibilities:
- Hold the API key; construct the Claude call; attach the versioned system prompt with a cache breakpoint.
- **Validate the model's JSON** against the schema before returning (defense in depth even with structured outputs).
- Enforce per-user **rate limits** and image size caps (downscale server-side toward the 2576px long-edge sweet spot to control image-token cost).
- Handle `stop_reason` edge cases (`max_tokens`, refusal) gracefully.
- Store images + a thumbnail; return signed URLs.

---

## 7. App structure (screens)

1. **Capture** — camera, guidance overlay ("fill the frame with the problem area"), optional use-case picker.
2. **Analyzing** — spinner / progress.
3. **Follow-up** — 0–3 quick questions as chips/toggles (skippable).
4. **Diagnosis card** — the hero screen: subject, severity meter, urgency badge, confidence, best fix / temp fix, DIY-vs-pro, risk-if-ignored, disclaimer. Big clear "This needs a pro → find one" CTA when `needs_professional`.
5. **History** — past scans grouped by property; before/after; mark resolved.
6. **Report/share** — export to PDF / link for contractor, landlord, insurer.
7. **Settings / paywall** — free scans per month, then subscription (see §11).

---

## 8. Trust & safety (a product feature, not boilerplate)

This app gives cost/safety advice about people's homes, so trust is the moat:

- **Confidence is always visible.** Low confidence changes the UI tone from "here's the fix" to "here's what to check / get this looked at."
- **Professional escape hatch** is a first-class field and a prominent CTA, especially for anything electrical, structural, gas, or roof-related.
- **Safety gating:** certain `professional_type` values (electrical, gas, structural) always surface a "do not DIY" warning regardless of `safe_to_diy`.
- **Visible disclaimer** on every diagnosis: *"FixSight gives a first-look estimate, not a professional inspection."* Reinforces §1 principle #2.
- **Poor-image guardrail** (`image_quality: "poor"`) → re-shoot instead of guess.

---

## 9. Phased delivery

**Phase 0 — Prove the engine (no app). ✅ DONE (web prototype).**
Backend endpoint + system prompt + schema, exercised through a real capture → diagnosis
card flow. The web prototype (`server.js` + `public/`) is this proof: photo → Claude
vision → strict JSON → rendered card, with the follow-up loop, safety bias, and
share-summary working. **Still to do within Phase 0:** feed it a *folder of real sample
photos* (ceiling stains, windows, cracks, a deliberately unassessable shot) and iterate
the system prompt until output is consistently sensible — right now it's proven on the
plumbing, not yet tuned against a curated image set.

**Phase 1 — Thin vertical slice (Expo).**
Port the proven flow to Expo: capture → `POST /scans` → render the diagnosis card. One or
two use cases end-to-end on a real phone. Reuse the prototype's prompt and (reconciled)
schema verbatim — the engine is already proven, this phase is about the native shell.

**Phase 2 — Follow-up loop + history.**
Q&A refinement, local scan storage, before/after.

**Phase 3 — Accounts, properties, reports, paywall.**
Auth, property grouping, PDF/share export, subscription.

**Phase 4+ — Hardware & breadth.**
Thermal mode, in-wall mode, more use cases, maintenance reminders, cost-range estimates. (See §10.)

---

## 10. Hardware roadmap (future — stubbed now)

- **Thermal mode (v2):** phone-attached thermal cameras (e.g. FLIR One / Seek). Ingest thermal image as an additional image in the same multi-image call; extend the schema with a `thermal_findings` block. No architecture change — just another image + schema fields.
- **In-wall mode (v3):** wall-scanning hardware for studs/pipes/wires. Likely a separate capture flow feeding a different prompt/schema.
- **Design for it now, build it later:** keep the request shape a list of images, keep the schema extensible, and put "Thermal / Wall scan — coming soon" placeholders in the capture UI so the roadmap is visible without blocking v1.

---

## 11. Cost model (rough, per scan)

Assuming Opus 4.8, one high-res image (~1.5k–4.8k image tokens) + ~1k prompt + ~0.8k output:

- **~$0.03–0.05 per single-call scan** on Opus 4.8.
- **~$0.015–0.025** on Sonnet 5 (its intro pricing is lower still through 2026-08-31).
- The follow-up loop roughly doubles a scan's cost (second call), but **prompt caching** on the large system prompt cuts the input side of every call by ~90% after the first, so real steady-state cost is lower than the naïve figure.

Implication for pricing: a **freemium** model (a few free scans/month, then subscription) comfortably covers inference cost with margin. Server-side image downscaling is the main cost lever.

---

## 12. Key risks & open questions

1. **Accuracy/trust risk (biggest).** If early diagnoses are wrong, users churn permanently. Mitigation: narrow scope, visible confidence, aggressive "get a pro" defaults, Phase 0 prompt tuning before any UI.
2. **Liability.** Home safety advice needs clear disclaimers and conservative defaults on electrical/structural/gas. Product-level, not just legal text.
3. **Image quality in the wild.** Bad lighting, wrong distance, motion blur. Mitigation: capture guidance overlay + the `image_quality` guardrail.
4. **Cost at scale.** Managed by model choice, downscaling, and prompt caching.
5. **Open decisions to make before Phase 1:**
   - Backend host (Vercel vs. Cloudflare Workers vs. Fly).
   - Auth provider (Clerk vs. Supabase vs. Firebase).
   - Image store (S3 vs. R2) and whether to use base64 inline vs. the Files API.
   - Exact v1 use-case list (proposed: windows/doors, ceiling stains, drywall cracks, flooring, water intrusion, visible exterior damage).

---

### TL;DR

Build a thin backend that holds the API key and turns **photo + context → strict JSON diagnosis** from Claude's vision model, and an Expo app that captures the photo, asks up to three smart follow-ups, and renders a trustworthy card with a confidence score and a clear "get a professional" path. Nail the **diagnosis engine in Phase 0** before building UI. Thermal and in-wall sensing are a designed-for-but-later roadmap; v1 is pure camera.
