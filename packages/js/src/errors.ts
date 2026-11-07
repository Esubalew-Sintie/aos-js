/** An error answer from the engine. `code` is stable: invalid_credentials,
 * wrong_code, signin_expired, rate_limited, sso_required, ... */
export class AosError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly details: Record<string, string>;

  constructor(status: number, code: string, message: string, type = "", details: Record<string, string> = {}) {
    super(message);
    this.name = "AosError";
    this.status = status;
    this.code = code;
    this.type = type;
    this.details = details;
  }
}

export function isAosError(e: unknown, code?: string): e is AosError {
  return e instanceof AosError && (code === undefined || e.code === code);
}
