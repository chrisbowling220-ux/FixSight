import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import express, {
  type ErrorRequestHandler,
  type Request,
} from "express";
import { ZodError } from "zod";

import {
  type AnalysisResult,
  type DiagnosisEngine,
} from "../src/diagnosis-engine.js";
import { parseAnalysis, type Analysis } from "../src/diagnosis-contract.js";
import { FixSightError } from "../src/errors.js";
import type { AnalyzeRequest } from "../src/request-schema.js";
import {
  createScanRouter,
  InMemoryScanRepository,
} from "../src/scans/index.js";

const IMAGE_DATA = Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64");
const REQUEST_BODY = {
  images: [{ data: IMAGE_DATA, media_type: "image/jpeg" }],
  category: "water intrusion",
  description: "A stain below the upstairs bathroom",
  answers: [],
} as const;

const QUESTIONS = parseAnalysis({
  result_type: "questions",
  note: "One detail would improve this assessment.",
  image_quality: "usable",
  retake_guidance: [],
  follow_up_questions: [
    {
      id: "q-duration",
      question: "How long has the stain been visible?",
      why_it_matters: "Its age helps distinguish an active leak from old damage.",
      options: ["Today", "Days", "Weeks or longer"],
    },
  ],
  diagnosis: null,
});

const DIAGNOSIS = parseAnalysis({
  result_type: "diagnosis",
  note: "The image and context support a first-look assessment.",
  image_quality: "good",
  retake_guidance: [],
  follow_up_questions: [],
  diagnosis: {
    subject: "ceiling water stain",
    diagnosis: "Likely moisture from a plumbing leak above the ceiling",
    likely_cause: "A bathroom supply or drain connection may be leaking",
    severity: 6,
    urgency: "soon",
    confidence: 0.79,
    safe_to_diy: false,
    recommendation: {
      best_fix: "Stop the leak source and dry the ceiling cavity before repair",
      cheap_or_temp_fix: "Avoid using the fixture above until it is inspected",
      tools_or_parts: ["moisture meter"],
      difficulty: "pro-only",
    },
    risk_if_ignored: "Continued moisture can damage framing and support mold growth",
    needs_professional: true,
    professional_type: "plumber",
    safety_warnings: ["Keep people away if the ceiling is sagging."],
    disclaimer_required: true,
  },
});

function result(analysis: Analysis, suffix = "initial"): AnalysisResult {
  return {
    analysis: structuredClone(analysis),
    metadata: {
      model_id: `test-model-${suffix}`,
      prompt_version: `test-prompt-${suffix}`,
    },
  };
}

class QueueEngine implements DiagnosisEngine {
  readonly calls: AnalyzeRequest[] = [];

  constructor(private readonly results: AnalysisResult[]) {}

  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    this.calls.push(structuredClone(request));
    const next = this.results.shift();
    if (!next) throw new Error("No fake analysis result remains.");
    return structuredClone(next);
  }
}

interface TestApi {
  baseUrl: string;
  engine: QueueEngine;
}

async function startApi(
  t: TestContext,
  analyses: Analysis[],
  repository = new InMemoryScanRepository(),
): Promise<TestApi> {
  const engine = new QueueEngine(
    analyses.map((analysis, index) => result(analysis, String(index + 1))),
  );
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/scans",
    createScanRouter({
      engine,
      repository,
      currentUserId: (request: Request) => request.header("x-test-user"),
    }),
  );

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ code: "invalid_request" });
      return;
    }
    if (error instanceof FixSightError) {
      response.status(error.status).json({ code: error.code, error: error.message });
      return;
    }
    response.status(500).json({ code: "internal_error" });
  };
  app.use(errors);

  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    },
  );
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}/scans`, engine };
}

async function apiFetch(
  baseUrl: string,
  path: string,
  user: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (user) headers.set("x-test-user", user);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function objectBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("create, list, and detail endpoints isolate every scan by current user", async (t) => {
  const api = await startApi(t, [QUESTIONS]);
  const createdResponse = await apiFetch(api.baseUrl, "", "alice", {
    method: "POST",
    body: JSON.stringify(REQUEST_BODY),
  });
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get("cache-control"), "no-store");
  const created = await objectBody(createdResponse);
  const scanId = created.scan_id;
  assert.equal(typeof scanId, "string");
  assert.equal(api.engine.calls.length, 1);

  const aliceList = await apiFetch(api.baseUrl, "", "alice");
  assert.equal(aliceList.status, 200);
  const alicePayload = await objectBody(aliceList);
  const aliceScans = alicePayload.scans as Array<Record<string, unknown>>;
  assert.equal(aliceScans.length, 1);
  assert.equal(aliceScans[0]?.id, scanId);
  assert.equal(aliceScans[0]?.status, "draft");
  assert.equal("user_id" in (aliceScans[0] ?? {}), false);
  assert.equal(JSON.stringify(alicePayload).includes(IMAGE_DATA), false);

  const bobList = await apiFetch(api.baseUrl, "", "bob");
  assert.deepEqual((await objectBody(bobList)).scans, []);
  const bobDetail = await apiFetch(api.baseUrl, `/${String(scanId)}`, "bob");
  assert.equal(bobDetail.status, 404);
  assert.equal((await objectBody(bobDetail)).code, "scan_not_found");

  const anonymous = await apiFetch(api.baseUrl, "", null);
  assert.equal(anonymous.status, 401);
  assert.equal((await objectBody(anonymous)).code, "authentication_required");
});

test("answers use stored images and canonical questions, then close the one refinement round", async (t) => {
  const api = await startApi(t, [QUESTIONS, DIAGNOSIS]);
  const created = await objectBody(
    await apiFetch(api.baseUrl, "", "alice", {
      method: "POST",
      body: JSON.stringify(REQUEST_BODY),
    }),
  );
  const scanId = String(created.scan_id);

  const unknown = await apiFetch(api.baseUrl, `/${scanId}/answers`, "alice", {
    method: "POST",
    body: JSON.stringify({
      answers: [{ question_id: "not-on-scan", answer: "A week" }],
    }),
  });
  assert.equal(unknown.status, 400);
  assert.equal((await objectBody(unknown)).code, "unknown_question");

  const refined = await apiFetch(api.baseUrl, `/${scanId}/answers`, "alice", {
    method: "POST",
    body: JSON.stringify({
      answers: [{ question_id: "q-duration", answer: "About two weeks" }],
    }),
  });
  assert.equal(refined.status, 200);
  const refinedPayload = await objectBody(refined);
  const scan = refinedPayload.scan as Record<string, unknown>;
  assert.equal(scan.status, "complete");
  assert.equal(scan.refinement_count, 1);
  assert.equal(api.engine.calls.length, 2);
  assert.deepEqual(api.engine.calls[1]?.images, api.engine.calls[0]?.images);
  assert.deepEqual(api.engine.calls[1]?.answers, [
    {
      question_id: "q-duration",
      question: "How long has the stain been visible?",
      answer: "About two weeks",
    },
  ]);

  const secondRound = await apiFetch(
    api.baseUrl,
    `/${scanId}/answers`,
    "alice",
    {
      method: "POST",
      body: JSON.stringify({
        answers: [{ question_id: "q-duration", answer: "Updated answer" }],
      }),
    },
  );
  assert.equal(secondRound.status, 409);
  assert.equal(api.engine.calls.length, 2);
});

test("report generation is deterministic and resolving a diagnosis uses no extra model call", async (t) => {
  const api = await startApi(t, [DIAGNOSIS]);
  const created = await objectBody(
    await apiFetch(api.baseUrl, "", "alice", {
      method: "POST",
      body: JSON.stringify(REQUEST_BODY),
    }),
  );
  const scanId = String(created.scan_id);

  const firstReportResponse = await apiFetch(
    api.baseUrl,
    `/${scanId}/report`,
    "alice",
    { method: "POST" },
  );
  const secondReportResponse = await apiFetch(
    api.baseUrl,
    `/${scanId}/report`,
    "alice",
    { method: "POST" },
  );
  const firstReport = await objectBody(firstReportResponse);
  const secondReport = await objectBody(secondReportResponse);
  assert.deepEqual(firstReport, secondReport);
  assert.equal(api.engine.calls.length, 1);
  const serializedReport = JSON.stringify(firstReport);
  assert.equal(serializedReport.includes(IMAGE_DATA), false);
  assert.equal(serializedReport.includes("alice"), false);
  assert.match(serializedReport, /not a professional inspection/);

  const resolvedResponse = await apiFetch(
    api.baseUrl,
    `/${scanId}/resolve`,
    "alice",
    {
      method: "POST",
      body: JSON.stringify({
        resolved: true,
        resolution_note: "Upstairs drain seal replaced",
      }),
    },
  );
  assert.equal(resolvedResponse.status, 200);
  const resolved = (await objectBody(resolvedResponse)).scan as Record<
    string,
    unknown
  >;
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.resolution_note, "Upstairs drain seal replaced");
  assert.equal(api.engine.calls.length, 1);
});

test("in-memory repository is bounded, user-scoped, and returns defensive copies", async () => {
  const ids = ["scan-1", "scan-2", "scan-3"];
  const repository = new InMemoryScanRepository({
    maxEntries: 2,
    maxImageBytes: 100,
    idFactory: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-07-15T12:00:00.000Z"),
  });
  const request = {
    images: [{ data: IMAGE_DATA, media_type: "image/jpeg" }],
    answers: [],
  } satisfies AnalyzeRequest;

  const first = await repository.create({
    user_id: "alice",
    request,
    result: result(QUESTIONS),
  });
  await repository.create({
    user_id: "bob",
    request,
    result: result(DIAGNOSIS),
  });
  const third = await repository.create({
    user_id: "alice",
    request,
    result: result(DIAGNOSIS),
  });

  assert.equal(await repository.getForUser("alice", first.id), null);
  assert.equal(await repository.getForUser("bob", third.id), null);
  assert.equal((await repository.listForUser("alice")).length, 1);
  assert.equal((await repository.listForUser("bob")).length, 1);

  third.analysis.note = "mutated outside the repository";
  const stored = await repository.getForUser("alice", third.id);
  assert.notEqual(stored?.analysis.note, third.analysis.note);
});

test("repository refinement claims are atomic until released", async () => {
  const repository = new InMemoryScanRepository();
  const scan = await repository.create({
    user_id: "alice",
    request: {
      images: [{ data: IMAGE_DATA, media_type: "image/jpeg" }],
      answers: [],
    },
    result: result(QUESTIONS),
  });

  const first = await repository.claimRefinement("alice", scan.id);
  assert.equal(first.ok, true);
  const simultaneous = await repository.claimRefinement("alice", scan.id);
  assert.deepEqual(simultaneous, { ok: false, reason: "in_progress" });
  await repository.releaseRefinement("alice", scan.id);
  const retry = await repository.claimRefinement("alice", scan.id);
  assert.equal(retry.ok, true);
});
