import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { AosError, InvalidTokenError } from "./errors.js";
import type { Claims } from "./types.js";

function b64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export class KeyCache {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastFetch = 0;

  constructor(
    private load: () => Promise<{ keys: Array<{ kty: string; crv: string; x: string; kid: string }> }>,
    private ttlMs: number,
    private now: () => number,
  ) {}

  async get(kid: string): Promise<KeyObject | undefined> {
    const known = this.keys.get(kid);
    const fresh = this.now() - this.fetchedAt < this.ttlMs;
    if (known && fresh) return known;
    // An unknown key may be a new one: refetch, but not more than every 10 s.
    const mayFetch = !fresh || (!known && this.now() - this.lastFetch > 10_000);
    if (!mayFetch) return known;
    let set;
    try {
      set = await this.load();
    } catch (e) {
      if (known) return known; // keep using a known key while the engine is unreachable
      throw e;
    }
    const next = new Map<string, KeyObject>();
    for (const k of set.keys ?? []) {
      if (k.kty !== "OKP" || k.crv !== "Ed25519") continue;
      next.set(k.kid, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x }, format: "jwk" }));
    }
    this.keys = next;
    this.fetchedAt = this.lastFetch = this.now();
    return next.get(kid);
  }
}

/** Checks a token's signature and expiry and returns its claims. */
export async function verifyWith(cache: KeyCache, token: string, now: () => number): Promise<Claims> {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) throw new InvalidTokenError();
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64(parts[0]).toString("utf8"));
  } catch {
    throw new InvalidTokenError();
  }
  if (header.alg !== "EdDSA" || !header.kid) throw new InvalidTokenError();
  const key = await cache.get(header.kid);
  if (!key) throw new InvalidTokenError();
  if (!verify(null, Buffer.from(parts[0] + "." + parts[1]), key, b64(parts[2]))) throw new InvalidTokenError();
  try {
    payload = JSON.parse(b64(parts[1]).toString("utf8"));
  } catch {
    throw new InvalidTokenError();
  }
  const exp = Number(payload.exp);
  if (typeof payload.sub !== "string" || !payload.sub || !Number.isFinite(exp)) throw new InvalidTokenError();
  // A minute of clock skew is allowed.
  if (Math.floor(now() / 1000) > exp + 60) throw new InvalidTokenError();
  return {
    userId: payload.sub,
    sessionId: String(payload.sid ?? ""),
    tenantId: String(payload.tid ?? ""),
    organization: (payload.org as string) || undefined,
    organizationId: (payload.org_id as string) || undefined,
    assuranceLevel: Number(payload.aal ?? 0),
    type: (payload.typ as string) || undefined,
    issuedAt: Number(payload.iat ?? 0),
    expiresAt: exp,
  };
}

/** The bearer token on a request's headers, or "". */
export function tokenFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): string {
  let v: string | null | undefined;
  if (typeof (headers as Headers).get === "function") v = (headers as Headers).get("authorization");
  else {
    const raw = (headers as Record<string, string | string[] | undefined>)["authorization"] ?? (headers as Record<string, string | string[] | undefined>)["Authorization"];
    v = Array.isArray(raw) ? raw[0] : raw;
  }
  if (!v) return "";
  const m = /^Bearer\s+(.+)$/i.exec(v.trim());
  return m ? m[1] : "";
}

export { AosError };
