// Helpers for frameworks built on the Fetch API's Request and Response:
// Next.js route handlers, Remix, Hono, Bun, Deno.
import { InvalidTokenError } from "./errors.js";
import { tokenFromHeaders } from "./token.js";
import type { Aos } from "./client.js";
import type { Claims, Resource } from "./types.js";

/** The claims of the request's session token, or null when there is none or it is invalid. */
export async function getAuth(aos: Aos, request: { headers: Headers }): Promise<Claims | null> {
  const token = tokenFromHeaders(request.headers);
  if (!token) return null;
  try {
    return await aos.verifyToken(token);
  } catch (e) {
    if (e instanceof InvalidTokenError) return null;
    throw e;
  }
}

/**
 * A route handler that answers the frontend's <Protect> questions:
 * POST {permissions: string[], resource?: {type, id}} → {results: {[permission]: boolean}}.
 * Without a resource, the active organization (or the root) is asked about.
 *
 * Next.js: `export const POST = canHandler(aos)` in app/api/aos/can/route.ts.
 */
export function canHandler(aos: Aos) {
  return async (request: Request): Promise<Response> => {
    const claims = await getAuth(aos, request);
    if (!claims) return Response.json({ error: { code: "unauthenticated", message: "sign in to continue" } }, { status: 401 });
    let body: { permissions?: unknown; resource?: Resource };
    try { body = await request.json(); } catch { body = {}; }
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p): p is string => typeof p === "string").slice(0, 100) : [];
    const resource = body.resource?.type && body.resource?.id ? body.resource
      : claims.organization ? { type: "organization", id: claims.organization } : { type: "tenant", id: "root" };
    if (permissions.length === 0) return Response.json({ results: {} });
    const answers = await aos.canBatch(permissions.map((permission) => ({ principal_id: claims.userId, permission, resource, session_id: claims.sessionId })));
    const results: Record<string, boolean> = {};
    permissions.forEach((p, i) => { results[p] = !!answers[i]?.allowed; });
    return Response.json({ results });
  };
}
