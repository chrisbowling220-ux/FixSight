import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
import { createVoiceRouter, createVoiceService } from "./voice/index.js";

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
      // Token counts (no content) so evaluations can compare cost per model.
      const usage = result.metadata;
      if (usage.input_tokens !== undefined) response.setHeader("x-fixsight-input-tokens", String(usage.input_tokens));
      if (usage.output_tokens !== undefined) response.setHeader("x-fixsight-output-tokens", String(usage.output_tokens));
      if (usage.cache_read_input_tokens !== undefined) {
        response.setHeader("x-fixsight-cache-read-tokens", String(usage.cache_read_input_tokens));
      }
      response.json(result.analysis);
    } catch (error) {
      next(error);
    }
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Optional shared-code gate for paid endpoints. Off unless FIXSIGHT_ACCESS_CODE
 * is set. It keeps an anonymous visitor to a public URL from spending provider
 * credit; it is not per-user authentication and does not isolate data.
 */
export function accessCodeGuard(code: string | undefined): RequestHandler {
  if (!code) return (_request, _response, next) => next();
  const expected = digest(code);
  return (request, response, next) => {
    const supplied = request.header("x-fixsight-access-code") ?? "";
    if (supplied !== "" && timingSafeEqual(digest(supplied), expected)) {
      next();
      return;
    }
    response.status(401).json({
      error: "This FixSight server needs an access code. Enter it in Settings.",
      code: "access_code_required",
    });
  };
}

function chain(...handlers: RequestHandler[]): RequestHandler {
  return (request, response, next) => {
    let index = 0;
    const step = (error?: unknown): void => {
      if (error !== undefined) {
        next(error);
        return;
      }
      const handler = handlers[index++];
      if (!handler) {
        next();
        return;
      }
      try {
        handler(request, response, step);
      } catch (thrown) {
        next(thrown);
      }
    };
    step();
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
          // blob: lets the browser play the streamed read-aloud audio the voice
          // endpoint returns (Feature B); without it playback fails silently.
          mediaSrc: ["'self'", "blob:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Helmet adds upgrade-insecure-requests by default. Over plain http
          // on a local network (how phones reach a development server) it
          // rewrites every same-origin script and stylesheet to https, which
          // fails and leaves a blank page. All assets are same-origin, so it
          // adds nothing on an https deployment either.
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_request, response, next) => {
    // microphone=(self) lets the web client open the mic for voice input.
    response.setHeader("permissions-policy", "camera=(self), microphone=(self)");
    next();
  });
  app.use(express.json({ limit: "60mb", type: "application/json" }));

  app.get("/api/health", (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.json({
      status: "ok",
      analysis_configured: config.demoMode || Boolean(config.anthropicApiKey),
      demo_mode: config.demoMode,
      environment: config.deploymentEnvironment,
      paid_providers_enabled:
        !config.demoMode && (Boolean(config.anthropicApiKey) || Boolean(config.voice.apiKey)),
      access_code_required: Boolean(config.accessCode),
      model_id: config.demoMode ? "demo" : config.model,
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
  const guard = accessCodeGuard(config.accessCode);
  const paid = chain(guard, limiter);

  const repository = new InMemoryScanRepository();
  const currentUserId = createDevUserIdResolver();
  const scanRouter = createScanRouter({ engine, repository, currentUserId });

  // The voice router applies `limiter` itself, but only to its paid POST routes
  // — `/api/voice/status` is a cheap poll and stays unmetered.
  const voiceRouter = createVoiceRouter(createVoiceService(config.voice), paid);

  app.post("/api/analyze", paid, analyze);
  app.use("/api/v1/scans", paid, scanRouter);
  app.use("/api/voice", voiceRouter);

  // On Vercel the platform serves this analytics script before the app runs.
  // Elsewhere, answer with an empty script instead of an HTML 404 that the
  // browser refuses to execute.
  app.get("/_vercel/insights/script.js", (_request, response) => {
    response.type("application/javascript").send("");
  });

  app.use(
    express.static(publicDir, {
      index: "index.html",
      maxAge: 0,
      setHeaders(response, filePath) {
        // The service worker must always be revalidated so updates reach users.
        if (filePath.endsWith("sw.js")) {
          response.setHeader("cache-control", "no-cache");
          response.setHeader("service-worker-allowed", "/");
        }
        if (filePath.endsWith(".webmanifest")) {
          response.setHeader("content-type", "application/manifest+json");
        }
      },
    }),
  );

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: "API endpoint not found.",
      code: "not_found",
    });
  });

  app.use(errorHandler());
  return app;
}
