import { AosError } from "./errors.js";
import { KeyCache, verifyWith } from "./token.js";
import type {
  APIKey, CanRequest, CanResult, Claims, FilterResult, Grant, KeyCheck, Member, Options, Organization, UserPage,
  Permission, Resource, Role, User, Webhook,
} from "./types.js";

export const VERSION = "0.4.0";

/**
 * The AOS client for your backend.
 *
 * ```ts
 * const aos = new Aos({ url: process.env.AOS_URL!, publishableKey: process.env.AOS_PUBLISHABLE_KEY, secretKey: process.env.AOS_SECRET_KEY });
 * const claims = await aos.verifyToken(token);
 * const { allowed } = await aos.can({ principal_id: claims.userId, permission: "invoice.refund", resource: { type: "invoice", id } });
 * ```
 */
export class Aos {
  readonly url: string;
  private opts: Options;
  private fetchFn: typeof fetch;
  private now: () => number;
  private keys: KeyCache;

  constructor(opts: Options) {
    if (!opts.url) throw new Error("aos: url is required");
    if (opts.secretKey && !opts.secretKey.startsWith("sk_")) throw new Error("aos: secretKey must be a secret key (sk_...)");
    if (opts.publishableKey && !opts.publishableKey.startsWith("pk_")) throw new Error("aos: publishableKey must be a publishable key (pk_...)");
    this.opts = opts;
    this.url = opts.url.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.keys = new KeyCache(() => this.jwks(), opts.keysTtlMs ?? 10 * 60_000, this.now);
  }

  private async jwks() {
    if (!this.opts.publishableKey) throw new Error("aos: verifying tokens needs the publishableKey option");
    const res = await this.fetchFn(this.url + "/v1/jwks.json", { headers: { "X-AOS-Publishable-Key": this.opts.publishableKey } });
    if (!res.ok) throw new AosError(res.status, "jwks_unavailable", "the engine did not return its public keys");
    return res.json();
  }

  /** Calls a backend route with the secret key and returns the answer's data. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.opts.secretKey) throw new Error("aos: backend calls need the secretKey option");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.secretKey}`,
      Accept: "application/json",
      "User-Agent": `aos-node/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchFn(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let payload: any = null;
    try { payload = await res.json(); } catch { /* empty */ }
    if (!res.ok || payload?.error) {
      const e = payload?.error ?? {};
      throw new AosError(res.status, e.code ?? "http_" + res.status, e.message ?? `the engine answered ${res.status}`, e.details);
    }
    return (payload?.data ?? null) as T;
  }

  // Tokens -------------------------------------------------------------

  /** Verifies a session token locally (public keys are cached). Throws InvalidTokenError. */
  verifyToken(token: string): Promise<Claims> {
    return verifyWith(this.keys, token, this.now);
  }

  // Permissions --------------------------------------------------------

  can(req: CanRequest) { return this.request<CanResult>("POST", "/v1/can", req); }
  async canBatch(checks: CanRequest[]): Promise<CanResult[]> {
    return (await this.request<{ results: CanResult[] }>("POST", "/v1/can/batch", { checks })).results;
  }
  /** The application's own ids where a permission holds, for list queries. */
  filter(principalId: string, permission: string, resourceType: string) {
    return this.request<FilterResult>("POST", "/v1/filter", { principal_id: principalId, permission, resource_type: resourceType });
  }
  explain(req: CanRequest) { return this.request<Record<string, unknown>>("POST", "/v1/explain", req); }

  readonly permissions = {
    put: (p: Permission) => this.request<Permission>("PUT", "/v1/permissions", p),
    list: () => this.request<Permission[]>("GET", "/v1/permissions"),
  };
  readonly roles = {
    put: (r: Role) => this.request<Role>("PUT", "/v1/roles", r),
    list: () => this.request<Role[]>("GET", "/v1/roles"),
  };
  readonly resources = {
    put: (r: Resource, parent?: Resource, displayName?: string) =>
      this.request("PUT", "/v1/resources", { type: r.type, id: r.id, display_name: displayName ?? "", ...(parent ? { parent } : {}) }),
  };
  readonly grants = {
    create: async (g: Grant) => (await this.request<{ id: string }>("POST", "/v1/grants", g)).id,
    delete: (id: string) => this.request("DELETE", `/v1/grants/${encodeURIComponent(id)}`),
  };

  // Users and organizations -------------------------------------------

  readonly users = {
    /** Makes an account and emails a setup link. With a role, they hold it from the start (on the root unless a resource is given). */
    create: (u: { email: string; name?: string; role?: string; resource?: Resource }) =>
      this.request<User>("POST", "/v1/users", u.role ? { ...u, resource: u.resource ?? { type: "tenant", id: "root" } } : u),
    get: (id: string) => this.request<User>("GET", `/v1/users/${encodeURIComponent(id)}`),
    list: (q: { cursor?: string; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.cursor) p.set("cursor", q.cursor);
      if (q.limit) p.set("limit", String(q.limit));
      const qs = p.toString();
      return this.request<UserPage>("GET", "/v1/users" + (qs ? "?" + qs : ""));
    },
    suspend: (id: string, reason = "") => this.request("POST", `/v1/users/${encodeURIComponent(id)}/suspend`, { reason }),
    reinstate: (id: string) => this.request("POST", `/v1/users/${encodeURIComponent(id)}/reinstate`),
    delete: (id: string) => this.request("DELETE", `/v1/users/${encodeURIComponent(id)}`),
  };

  readonly organizations = {
    create: (name: string, slug: string, ownerPrincipalId?: string) =>
      this.request<Organization>("POST", "/v1/admin/organizations", { name, slug, owner_principal_id: ownerPrincipalId }),
    list: () => this.request<Organization[]>("GET", "/v1/admin/organizations"),
    members: (id: string) => this.request<Member[]>("GET", `/v1/admin/organizations/${encodeURIComponent(id)}/members`),
    invite: (id: string, email: string, role: string) =>
      this.request("POST", `/v1/admin/organizations/${encodeURIComponent(id)}/invitations`, { email, role }),
  };

  // Machines and webhooks ---------------------------------------------

  readonly apiKeys = {
    create: (principalId: string, name: string, scopes: string[] = []) =>
      this.request<APIKey>("POST", "/v1/api-keys", { principal_id: principalId, name, scopes }),
    /** Identifies a key a caller presented; with a permission, checks it within the key's scopes. */
    check: (key: string, permission?: string, on?: Resource) =>
      this.request<KeyCheck>("POST", "/v1/api-keys/check", permission ? { key, permission, resource: on ?? { type: "tenant", id: "root" } } : { key }),
  };

  readonly webhooks = {
    create: (url: string, eventTypes: string[] = []) => this.request<Webhook>("POST", "/v1/webhooks", { url, event_types: eventTypes }),
  };
}
