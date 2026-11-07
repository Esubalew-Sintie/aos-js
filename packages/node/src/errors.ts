/** An error answer from the engine. A permission deny is not an error. */
export class AosError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string>;
  constructor(status: number, code: string, message: string, details: Record<string, string> = {}) {
    super(message);
    this.name = "AosError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A token that is malformed, signed by another tenant, tampered with or expired. */
export class InvalidTokenError extends Error {
  constructor() {
    super("aos: invalid or expired token");
    this.name = "InvalidTokenError";
  }
}

/** A webhook delivery that was not signed with the endpoint's secret, or is too old. */
export class BadSignatureError extends Error {
  constructor() {
    super("aos: webhook signature does not match");
    this.name = "BadSignatureError";
  }
}
