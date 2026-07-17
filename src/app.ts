import { randomUUID } from "node:crypto";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";

import type { AppConfig } from "./config.js";
import type { DiagnosisEngine } from "./diagnosis-engine.js";
import { FixSightError } from "./errors.js";
import { PROMPT_VERSION } from "./prompt.js";
import { parseAnalyzeRequest } from "./request-schema.js";
import { createDevUserIdResolver } from "./auth.js";
import { createScanRouter, InMemoryScanRepository } from "./scans/index.js";

interface RequestWithId extends Request {
  requestId?: string;
}

export interface AppDependencies {
  config: AppConfig;
  engine: DiagnosisEngine;
  publicDir?: string;
}

function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header("x-request-id");
  request.requestId =
    incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)
      ? incoming
      : randomUUID();
  response.setHeader("x-request-id", request.requestId);
  next();
}

function analyzeHandler(engine: DiagnosisEngine): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = parseAnalyzeRequest(request.body);
      const result = await engine.analyze(input);

      response.setHeader("cache-control", "no-store");
      response.setHeader("x-fixsight-model", result.metadata.model_id);
      response.setHeader(
        "x-fixsight-prompt-version",
        result.metadata.prompt_version,
      );
      response.json(result.analysis);
    } catch (error) {
      next(error);
    }
  };
}

function errorHandler(): ErrorRequestHandler {
  return (
    error: unknown,
    request: RequestWithId,
    response: Response,
    _next: NextFunction,
  ): void => {
    const requestId = request.requestId ?? "unknown";

    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      response.status(413).json({
        error: "The photo request is too large.",
        code: "request_too_large",
        request_id: requestId,
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({
        error: "The analysis request is invalid.",
        code: "invalid_request",
        request_id: requestId,
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    if (error instanceof FixSightError) {
      if (!error.expose) {
        console.error(
          `[${requestId}] ${error.code}: ${error.message}`,
          error.cause,
        );
      }
      response.status(error.status).json({
        error: error.expose
          ? error.message
          : "The analysis service returned an unusable result. Please try again.",
        code: error.code,
        request_id: requestId,
      });
      return;
    }

    if (error instanceof Anthropic.RateLimitError) {
      response.status(429).json({
        error: "The analysis service is busy. Wait a moment and try again.",
        code: "provider_rate_limited",
        request_id: requestId,
      });
      return;
    }

    if (error instanceof Anthropic.APIError) {
      console.error(
        `[${requestId}] Anthropic API error ${error.status}: ${error.message}`,
      );
      response.status(502).json({
        error: "The analysis service had a problem. Please try again.",
        code: "provider_error",
        request_id: requestId,
      });
      return;
    }

    console.error(`[${requestId}] Unexpected server error`, error);
    response.status(500).json({
      error: "Something went wrong. Please try again.",
      code: "internal_error",
      request_id: requestId,
    });
  };
}

export function createApp({
  config,
  engine,
  publicDir = path.resolve(process.cwd(), "public"),
}: AppDependencies): express.Express {
  const app = express();

  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_request, response, next) => {
    response.setHeader("permissions-policy", "camera=(self)");
    next();
  });
  app.use(express.json({ limit: "60mb", type: "application/json" }));

  app.get("/api/health", (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.json({
      status: "ok",
      analysis_configured: Boolean(config.anthropicApiKey),
      model_id: config.model,
      prompt_version: PROMPT_VERSION,
    });
  });

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many scans from this connection. Wait and try again.",
      code: "rate_limited",
    },
  });
  const analyze = analyzeHandler(engine);

  const repository = new InMemoryScanRepository();
  const currentUserId = createDevUserIdResolver();
  const scanRouter = createScanRouter({ engine, repository, currentUserId });

  app.post("/api/analyze", limiter, analyze);
  app.use("/api/v1/scans", limiter, scanRouter);

  app.use(express.static(publicDir, { index: "index.html", maxAge: 0 }));

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: "API endpoint not found.",
      code: "not_found",
    });
  });

  app.use(errorHandler());
  return app;
}
