import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import type { DiagnosisEngine } from "../diagnosis-engine.js";
import { FixSightError } from "../errors.js";
import { parseAnalyzeRequest, type AnalyzeRequest } from "../request-schema.js";
import { buildScanReport } from "./report.js";
import {
  ScanRepositoryCapacityError,
  type RefinementRejection,
  type ScanRepository,
} from "./repository.js";
import { toPublicScan, type StoredScan } from "./types.js";

export type CurrentUserIdResolver = (
  request: Request,
) => Promise<string | null | undefined> | string | null | undefined;

export interface ScanRouterDependencies {
  engine: DiagnosisEngine;
  repository: ScanRepository;
  currentUserId: CurrentUserIdResolver;
}

class ScanApiError extends FixSightError {
  constructor(message: string, status: number, code: string) {
    super(message, status, code, true);
  }
}

type AsyncHandler = (
  request: Request,
  response: Response,
) => Promise<void>;

function route(handler: AsyncHandler): RequestHandler {
  return (request, response, next): void => {
    void handler(request, response).catch(next);
  };
}

function noStore(response: Response): void {
  response.setHeader("cache-control", "no-store");
}

function setAnalysisHeaders(
  response: Response,
  scan: StoredScan,
): void {
  response.setHeader("x-fixsight-model", scan.metadata.model_id);
  response.setHeader(
    "x-fixsight-prompt-version",
    scan.metadata.prompt_version,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ScanApiError(message, 400, "invalid_request");
  }
}

async function requireUserId(
  resolver: CurrentUserIdResolver,
  request: Request,
): Promise<string> {
  const value = await resolver(request);
  const userId = typeof value === "string" ? value.trim() : "";
  if (userId === "") {
    throw new ScanApiError(
      "Authentication is required to access scans.",
      401,
      "authentication_required",
    );
  }
  if (userId.length > 200) {
    throw new ScanApiError("The authenticated user id is invalid.", 401, "invalid_identity");
  }
  return userId;
}

function idFrom(request: Request): string {
  const rawId = request.params.id;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (id === "" || id.length > 200) {
    throw new ScanApiError("Scan not found.", 404, "scan_not_found");
  }
  return id;
}

function notFound(): ScanApiError {
  return new ScanApiError("Scan not found.", 404, "scan_not_found");
}

function refinementError(reason: RefinementRejection): ScanApiError {
  if (reason === "not_found") return notFound();
  const messages: Record<Exclude<RefinementRejection, "not_found">, string> = {
    not_awaiting_answers: "This scan is not waiting for follow-up answers.",
    already_refined: "This scan has already used its follow-up round.",
    in_progress: "This scan is already being refined.",
    resolved: "A resolved scan cannot be refined.",
  };
  return new ScanApiError(messages[reason], 409, `scan_${reason}`);
}

function answerRequest(body: unknown, scan: StoredScan): AnalyzeRequest {
  if (!isRecord(body)) {
    throw new ScanApiError(
      "The follow-up answer request is invalid.",
      400,
      "invalid_request",
    );
  }
  requireOnlyKeys(
    body,
    new Set(["answers"]),
    "The follow-up answer request contains an unsupported field.",
  );
  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    throw new ScanApiError(
      "Provide at least one follow-up answer.",
      400,
      "invalid_answers",
    );
  }

  const available = new Map(
    scan.analysis.follow_up_questions.map((question) => [question.id, question]),
  );
  const seen = new Set<string>();
  const answers = body.answers.map((value) => {
    if (!isRecord(value)) {
      throw new ScanApiError(
        "Each follow-up answer must be an object.",
        400,
        "invalid_answers",
      );
    }
    requireOnlyKeys(
      value,
      new Set(["question_id", "question", "answer"]),
      "A follow-up answer contains an unsupported field.",
    );
    const id = typeof value.question_id === "string" ? value.question_id.trim() : "";
    const question = available.get(id);
    if (!question) {
      throw new ScanApiError(
        "A follow-up answer does not match a question on this scan.",
        400,
        "unknown_question",
      );
    }
    if (seen.has(id)) {
      throw new ScanApiError(
        "Each follow-up question can be answered only once.",
        400,
        "duplicate_answer",
      );
    }
    seen.add(id);
    return {
      question_id: id,
      question: question.question,
      answer: value.answer,
    };
  });

  return parseAnalyzeRequest({
    images: scan.request.images,
    ...(scan.request.category !== undefined
      ? { category: scan.request.category }
      : {}),
    ...(scan.request.description !== undefined
      ? { description: scan.request.description }
      : {}),
    answers,
  });
}

function resolutionRequest(body: unknown): {
  resolved: boolean;
  note: string | null;
} {
  if (!isRecord(body)) {
    throw new ScanApiError(
      "The resolution request is invalid.",
      400,
      "invalid_request",
    );
  }
  requireOnlyKeys(
    body,
    new Set(["resolved", "resolution_note"]),
    "The resolution request contains an unsupported field.",
  );
  if (typeof body.resolved !== "boolean") {
    throw new ScanApiError(
      "The resolved field must be true or false.",
      400,
      "invalid_resolution",
    );
  }
  if (
    body.resolution_note !== undefined &&
    typeof body.resolution_note !== "string"
  ) {
    throw new ScanApiError(
      "The resolution note must be text.",
      400,
      "invalid_resolution",
    );
  }
  const note =
    typeof body.resolution_note === "string"
      ? body.resolution_note.trim()
      : "";
  if (note.length > 2_000) {
    throw new ScanApiError(
      "The resolution note must be 2,000 characters or fewer.",
      400,
      "invalid_resolution",
    );
  }
  return { resolved: body.resolved, note: note === "" ? null : note };
}

export function createScanRouter({
  engine,
  repository,
  currentUserId,
}: ScanRouterDependencies): express.Router {
  const router = express.Router();

  router.post(
    "/",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const input = parseAnalyzeRequest(request.body);
      const result = await engine.analyze(input);

      let scan: StoredScan;
      try {
        scan = await repository.create({ user_id: userId, request: input, result });
      } catch (error) {
        if (error instanceof ScanRepositoryCapacityError) {
          throw new ScanApiError(error.message, 503, "scan_store_full");
        }
        throw error;
      }

      noStore(response);
      setAnalysisHeaders(response, scan);
      response.status(201).json({
        scan_id: scan.id,
        diagnosis: scan.analysis,
        scan: toPublicScan(scan),
      });
    }),
  );

  router.get(
    "/",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const scans = await repository.listForUser(userId);
      noStore(response);
      response.json({ scans: scans.map(toPublicScan) });
    }),
  );

  router.get(
    "/:id",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const scan = await repository.getForUser(userId, idFrom(request));
      if (!scan) throw notFound();
      noStore(response);
      setAnalysisHeaders(response, scan);
      response.json({ scan: toPublicScan(scan) });
    }),
  );

  router.post(
    "/:id/answers",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const scanId = idFrom(request);
      const claim = await repository.claimRefinement(userId, scanId);
      if (!claim.ok) throw refinementError(claim.reason);

      try {
        const input = answerRequest(request.body, claim.scan);
        const result = await engine.analyze(input);
        const scan = await repository.completeRefinement(
          userId,
          scanId,
          input,
          result,
        );
        noStore(response);
        setAnalysisHeaders(response, scan);
        response.json({
          scan_id: scan.id,
          diagnosis: scan.analysis,
          scan: toPublicScan(scan),
        });
      } catch (error) {
        await repository.releaseRefinement(userId, scanId);
        throw error;
      }
    }),
  );

  router.post(
    "/:id/report",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const scan = await repository.getForUser(userId, idFrom(request));
      if (!scan) throw notFound();
      noStore(response);
      response.json({ report: buildScanReport(scan) });
    }),
  );

  router.post(
    "/:id/resolve",
    route(async (request, response) => {
      const userId = await requireUserId(currentUserId, request);
      const scanId = idFrom(request);
      const current = await repository.getForUser(userId, scanId);
      if (!current) throw notFound();
      if (
        current.status !== "complete" ||
        current.analysis.result_type !== "diagnosis"
      ) {
        throw new ScanApiError(
          "Only a completed diagnosis can be marked resolved.",
          409,
          "scan_not_resolvable",
        );
      }
      const resolution = resolutionRequest(request.body);
      const scan = await repository.setResolution(
        userId,
        scanId,
        resolution.resolved,
        resolution.note,
      );
      if (!scan) throw notFound();
      noStore(response);
      response.json({ scan: toPublicScan(scan) });
    }),
  );

  return router;
}

// Keep the imported Express next-function type checked for consumers wrapping the router.
export type ScanRouterNextFunction = NextFunction;
