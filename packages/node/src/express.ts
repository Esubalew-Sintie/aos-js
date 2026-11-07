import { InvalidTokenError } from "./errors.js";
import { tokenFromHeaders } from "./token.js";
import type { Aos } from "./client.js";
import type { Claims, Resource } from "./types.js";

// Express-compatible types, kept minimal so Express is not a dependency.
type Req = { headers: Record<string, string | string[] | undefined>; params?: Record<string, string>; query?: Record<string, unknown>; aos?: Claims };
type Res = { status(code: number): Res; json(body: unknown): unknown };
type Next = (err?: unknown) => void;

function deny(res: Res, status: number, code: string, message: string) {
  res.status(status).json({ status: "error", error: { code, message } });
}

/** Verifies the session token; sets req.aos to the claims. 401 without one. */
export function requireAuth(aos: Aos, opts: { optional?: boolean } = {}) {
  return async (req: Req, res: Res, next: Next) => {
    const token = tokenFromHeaders(req.headers);
    if (!token) {
      if (opts.optional) return next();
      return deny(res, 401, "unauthenticated", "sign in to continue");
    }
    try {
      req.aos = await aos.verifyToken(token);
      next();
    } catch (e) {
      if (opts.optional && e instanceof InvalidTokenError) return next();
      if (e instanceof InvalidTokenError) return deny(res, 401, "unauthenticated", "sign in to continue");
      deny(res, 503, "auth_unavailable", "the session could not be checked");
    }
  };
}

/** The top of the tenant's tree. */
export const root = (): Resource => ({ type: "tenant", id: "root" });
/** The organization the person is working in, or the root. */
export const activeOrganization = (req: { aos?: Claims }): Resource =>
  req.aos?.organization ? { type: "organization", id: req.aos.organization } : root();

/** 403 unless the signed-in person holds the permission. Put it after requireAuth. */
export function requirePermission<R extends Req>(aos: Aos, permission: string, resource: (req: R) => Resource = activeOrganization) {
  return async (req: R, res: Res, next: Next) => {
    if (!req.aos) return deny(res, 401, "unauthenticated", "sign in to continue");
    try {
      const r = await aos.can({ principal_id: req.aos.userId, permission, resource: resource(req), session_id: req.aos.sessionId });
      if (!r.allowed) return deny(res, 403, r.reason, "you may not do this");
      next();
    } catch {
      deny(res, 503, "permission_check_failed", "the permission could not be checked");
    }
  };
}

/**
 * Answers the frontend's <Protect> questions in Express:
 * `app.post("/api/aos/can", express.json(), canMiddleware(aos))`.
 */
export function canMiddleware(aos: Aos) {
  return async (req: Req & { body?: { permissions?: unknown; resource?: Resource } }, res: Res) => {
    const token = tokenFromHeaders(req.headers);
    let claims: Claims;
    try {
      claims = await aos.verifyToken(token);
    } catch {
      return deny(res, 401, "unauthenticated", "sign in to continue");
    }
    const body = req.body ?? {};
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p): p is string => typeof p === "string").slice(0, 100) : [];
    const resource = body.resource?.type && body.resource?.id ? body.resource : activeOrganization({ aos: claims });
    try {
      const answers = permissions.length
        ? await aos.canBatch(permissions.map((permission) => ({ principal_id: claims.userId, permission, resource, session_id: claims.sessionId })))
        : [];
      const results: Record<string, boolean> = {};
      permissions.forEach((p, i) => { results[p] = !!answers[i]?.allowed; });
      res.status(200).json({ results });
    } catch {
      deny(res, 503, "permission_check_failed", "the permission could not be checked");
    }
  };
}
