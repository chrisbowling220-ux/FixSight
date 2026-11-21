export class DeadlineExceededError extends Error {
  constructor() {
    super("The request timed out.");
    this.name = "DeadlineExceededError";
  }
}

/** Limit how long a request can occupy the scan flow; cancellation does not
 * guarantee that the server stopped processing the request. */
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  let expired = false;
  const timer = setTimeout(() => { expired = true; cancel(); }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (expired && !externalSignal?.aborted) throw new DeadlineExceededError();
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}
