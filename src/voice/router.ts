import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import type { VoiceService } from "./elevenlabs.js";

type AsyncHandler = (request: Request, response: Response) => Promise<void>;

function route(handler: AsyncHandler): RequestHandler {
  return (request, response, next): void => {
    void handler(request, response).catch(next);
  };
}

function noStore(response: Response): void {
  response.setHeader("cache-control", "no-store");
}

/**
 * Voice endpoints, mounted under `/api/voice`. Deliberately no user auth — this
 * matches `/api/analyze`, the app's other paid-provider endpoint, protected by
 * the shared rate limiter rather than a sign-in.
 *
 * The limiter is applied only to the two paid POST routes. `/status` is a cheap,
 * secret-free read the web client polls on every page load; putting it behind
 * the shared 20-req/15-min budget would let reloads exhaust the scan allowance
 * and, worse, a rate-limited status poll would silently hide the mic button.
 */
export function createVoiceRouter(
  voice: VoiceService,
  limiter: RequestHandler,
): express.Router {
  const router = express.Router();

  router.get("/status", (_request, response) => {
    noStore(response);
    response.json(voice.status());
  });

  router.post(
    "/transcribe",
    limiter,
    route(async (request, response) => {
      const result = await voice.transcribe(request.body);
      noStore(response);
      response.json(result);
    }),
  );

  router.post(
    "/synthesize",
    limiter,
    route(async (request, response) => {
      const { contentType, body } = await voice.synthesize(request.body);
      noStore(response);
      response.setHeader("content-type", contentType);
      // Pipe the upstream stream straight through so the voice starts playing as
      // the first chunk lands rather than after the whole clip is generated.
      const stream = Readable.fromWeb(
        body as unknown as NodeReadableStream<Uint8Array>,
      );
      // Without this, a mid-stream upstream failure leaves the socket hanging.
      stream.on("error", () => {
        if (!response.headersSent) response.status(502);
        response.destroy();
      });
      stream.pipe(response);
    }),
  );

  return router;
}
