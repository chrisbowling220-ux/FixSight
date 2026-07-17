# FixSight — Engineering Standards & Review Bar

**Purpose:** the single quality bar every change is held to. Whoever writes code — a builder agent, a human, or a tool — targets this. The guardian (reviewer) checks every meaningful change against it before it's considered *done*. Nothing ships that hasn't passed.

Read alongside [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) — the plan says *what* we build; this says *how well*.

**Applies to two codebases.** The bar is the same for both, but a few mechanics differ:
- **The web prototype (built, running today)** — vanilla JS, Express, browser localStorage. Where this doc says "TypeScript strict" or "typecheck + lint," the prototype instead requires: no undeclared globals, `"use strict"`, and no console errors in the browser. Where it says "server-side downscaling toward 2576px," the prototype does **client-side resize to 1568px** before upload — same intent (bound token cost), different place.
- **The Expo/TS production app (ahead of us)** — the doc's TypeScript-specific rules apply as written once we're there.

The **non-negotiables and the trust/safety rules below apply identically to both** — they're about the product, not the stack.

---

## Non-negotiables (breaking these blocks the change)

1. **The API key never leaves the backend.** No `ANTHROPIC_API_KEY` in the app, in client bundles, in git, or in logs. All model calls go through our server. (Plan §2, §6.)
2. **No secrets committed.** Keys, tokens, `.env` files → gitignored. If one lands in a commit, it's rotated, not just deleted.
3. **One source of truth for the diagnosis schema.** The JSON contract (Plan §4.2) is defined once and shared by app + backend. No two hand-copied versions that drift.
4. **The model's output is validated before use.** Even with structured outputs, the backend validates the JSON against the schema and handles `stop_reason` edge cases (`max_tokens`, `refusal`) instead of trusting the response blindly.
5. **Official SDK only for Claude.** `@anthropic-ai/sdk` on the backend — never raw `fetch` against the API, never from the app.

## Code quality

- **TypeScript strict mode on.** No `any` without a written reason. Types come from the shared schema, not re-declared per file.
- **Match the surrounding code.** Naming, structure, comment density, idioms stay consistent across the codebase. New code should be indistinguishable from good existing code.
- **Small, single-purpose modules.** If a file does three unrelated things, it's three files.
- **Errors and edge cases are handled, not swallowed.** No empty `catch`, no unhandled promise rejections, no silent failures.

## No trash

- **No dead code** — no commented-out blocks "just in case," no unused imports/vars/files, no leftover scaffolding.
- **No stray debug output** — no `console.log` left in shipping paths.
- **No orphan TODOs** — a TODO without a tracked follow-up is either done now or deleted.
- **No half-features** — don't add abstractions, config flags, or error handling for scenarios that can't happen. Do the simplest thing that works well (Plan-aligned; keeps the codebase lean).

## The app must actually work

- **Loading, empty, and error states exist** for every screen that does async work. A spinner that never resolves is a bug.
- **The camera → diagnosis → card flow is exercised end-to-end** before that flow is called done — not just unit-tested in isolation.
- **Poor-image and low-confidence paths are real UI**, not dead schema fields (Plan §8).

## Security & trust

- **Validate at boundaries** — user input, image size/type, and every request the backend accepts.
- **Server-side image downscaling** toward the 2576px long-edge target to bound token cost.
- **Safety gating is enforced in code** — electrical/structural/gas diagnoses always surface the "get a professional" warning regardless of the DIY flag (Plan §8).

## Definition of Done (a change isn't finished until all are true)

- [ ] Does what was asked; nothing half-built left behind.
- [ ] Typecheck + lint clean.
- [ ] Ran/exercised the affected flow and observed it work (not just "tests pass").
- [ ] No new trash (dead code, debug logs, orphan TODOs, committed secrets).
- [ ] Consistent with the plan and the existing code.
- [ ] Reviewed against this bar.

---

## The guardian's review rubric (applied every pass)

When work lands, it's checked on six axes, most-severe first:

1. **Correctness** — will it actually work, including the unhappy paths?
2. **Plan-adherence** — does it match [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md), or is there a good reason it shouldn't?
3. **Simplicity / no-cruft** — is anything here more complicated than it needs to be? Anything dead?
4. **Consistency** — does it read like the rest of the codebase?
5. **Security** — key handling, input validation, secrets.
6. **Verified** — was it actually run, or just claimed done?

Findings are stated plainly with the fix. The guardian pushes back on "good enough" and rubber-stamps nothing — but explains *why*, so it makes the work better instead of just slowing it down.

**Tooling the guardian uses:** `/code-review` for a real diff review, `/simplify` for cruft/altitude cleanup, `/security-review` before anything auth- or key-related ships, and the `verify` skill to confirm a change runs.
