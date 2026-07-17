export class FixSightError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly expose = true,
    readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = new.target.name;
  }
}

export class InvalidImageError extends FixSightError {
  constructor(message: string, cause?: unknown) {
    super(message, 400, "invalid_image", true, cause);
  }
}

export class ProviderUnavailableError extends FixSightError {
  constructor(message = "The analysis service is not configured.") {
    super(message, 503, "analysis_unavailable", true);
  }
}

export class ProviderResponseError extends FixSightError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, "invalid_provider_response", false, cause);
  }
}
