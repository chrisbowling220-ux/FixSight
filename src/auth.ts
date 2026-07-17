import type { Request } from "express";

export type UserIdResolver = (
  request: Request
) => Promise<string | null | undefined> | string | null | undefined;

/** Dev-mode resolver: read X-FixSight-User-Id header or fall back to IP. */
export function createDevUserIdResolver(): UserIdResolver {
  return (request: Request): string => {
    const header = request.header("x-fixsight-user-id");
    if (header && header.trim() && header.trim().length <= 200) {
      return header.trim();
    }
    const ip = (
      request.ip ??
      (request.socket as { remoteAddress?: string } | undefined)?.remoteAddress ??
      "unknown"
    ).replace(/[^a-zA-Z0-9._:-]/g, "_");
    return `ip-${ip}`;
  };
}
