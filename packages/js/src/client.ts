import { AosError } from "./errors.js";
import { creationOptions, requestOptions, serializeCredential } from "./passkey.js";
import type {
  ClientOptions, DeviceSession, Factors, Invitation, InvitationPreview, Member, Organization, Passkey, Session,
  SessionInfo, SignInResult, TokenStorage, User,
} from "./types.js";

type Listener = (session: Session | null) => void;

const KEY_SESSION = "aos.session";
const KEY_ACCESS = "aos.access";
const KEY_REFRESH = "aos.refresh";
const KEY_PENDING = "aos.pending";

class MemoryStorage implements TokenStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function defaultStorage(): TokenStorage {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem("aos.probe");
      return localStorage;
    }
  } catch { /* storage blocked: fall back to memory */ }
  return new MemoryStorage();
}

/**
 * The AOS client for browsers and mobile apps. One per application.
 *
 * ```ts
 * const aos = createClient({ url: "https://auth.example.com", publishableKey: "pk_live_..." });
 * const r = await aos.signIn({ email, password });
 * if (r.status === "second_factor") await aos.secondFactor({ method: "totp", code });
 * const res = await aos.fetch("/api/invoices"); // your backend, with the session token attached
 * ```
 */
export class AosClient {
  readonly url: string;
  readonly publishableKey: string;
  readonly sessionKind: "browser" | "token";
  private storage: TokenStorage;
  private fetchFn: typeof fetch;
  private listeners = new Set<Listener>();
  private current: Session | null | undefined;
  private backendToken: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: ClientOptions) {
    if (!opts.url) throw new Error("aos: url is required");
    if (!opts.publishableKey?.startsWith("pk_")) throw new Error("aos: publishableKey must be a publishable key (pk_...)");
    this.url = opts.url.replace(/\/+$/, "");
    this.publishableKey = opts.publishableKey;
    this.sessionKind = opts.sessionKind ?? "browser";
    this.storage = opts.storage ?? defaultStorage();
    this.fetchFn = opts.fetch ?? ((...a) => fetch(...a));
  }

  // ------------------------------------------------------------------
  // Transport
  // ------------------------------------------------------------------

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "X-AOS-Publishable-Key": this.publishableKey, Accept: "application/json" };
    if (this.sessionKind === "token") {
      const access = await this.storage.getItem(KEY_ACCESS);
      if (access) h.Authorization = `Bearer ${access}`;
    } else {
      const dev = await this.storage.getItem(KEY_SESSION);
      if (dev) h["X-AOS-Session"] = dev;
    }
    return h;
  }

  /** Calls the engine and returns the "data" of its answer. */
  async request<T = unknown>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers = await this.headers();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchFn(this.url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
    let payload: any = null;
    try { payload = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401 && this.sessionKind === "token" && !retried && !path.startsWith("/v1/token/refresh") && (await this.refresh())) {
      return this.request<T>(method, path, body, true);
    }
    if (!res.ok || payload?.error) {
      const e = payload?.error ?? {};
      throw new AosError(res.status, e.code ?? "http_" + res.status, e.message ?? `the engine answered ${res.status}`, e.type, e.details);
    }
    return (payload?.data ?? null) as T;
  }

  /** Stores what a signed-in answer carries. */
  private async adopt(data: any): Promise<SignInResult> {
    if (data?.second_factor_required) {
      await this.storage.setItem(KEY_PENDING, data.pending_token);
      return { status: "second_factor", methods: data.methods ?? [] };
    }
    if (data?.access_token) {
      await this.storage.setItem(KEY_ACCESS, data.access_token);
      if (data.refresh_token) await this.storage.setItem(KEY_REFRESH, data.refresh_token);
    } else if (data?.session_token) {
      // A development tenant: the session travels in a header.
      await this.storage.setItem(KEY_SESSION, data.session_token);
    }
    await this.storage.removeItem(KEY_PENDING);
    this.backendToken = null;
    const session: Session = { user: data.user, session: data.session };
    this.setSession(session);
    return { status: "signed_in", user: data.user, session: data.session, secondFactorSetupRequired: !!data.second_factor_setup_required };
  }

  private async forget(): Promise<void> {
    await Promise.all([KEY_SESSION, KEY_ACCESS, KEY_REFRESH, KEY_PENDING].map((k) => this.storage.removeItem(k)));
    this.backendToken = null;
    this.setSession(null);
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const refreshToken = await this.storage.getItem(KEY_REFRESH);
      if (!refreshToken) return false;
      try {
        const data: any = await this.request("POST", "/v1/token/refresh", { refresh_token: refreshToken }, true);
        await this.storage.setItem(KEY_ACCESS, data.access_token);
        await this.storage.setItem(KEY_REFRESH, data.refresh_token);
        return true;
      } catch {
        await this.forget();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private setSession(s: Session | null) {
    this.current = s;
    for (const l of this.listeners) l(s);
  }

  /** Called whenever the person signs in, out, or switches organization. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------------
  // Session
  // ------------------------------------------------------------------

  /** Who is signed in, or null. Asks the engine once, then remembers. */
  async getSession(force = false): Promise<Session | null> {
    if (this.current !== undefined && !force) return this.current;
    try {
      const s = await this.request<Session>("GET", "/v1/session");
      this.setSession(s);
      return s;
    } catch (e) {
      if (e instanceof AosError && (e.status === 401 || e.code === "second_factor_setup_required")) {
        this.setSession(null);
        return null;
      }
      throw e;
    }
  }

  /**
   * A signed token, valid 60 seconds, for your own backend to verify.
   * It is reused until 10 seconds before it expires.
   */
  async getToken(): Promise<string | null> {
    if (this.backendToken && this.backendToken.expiresAt - Date.now() > 10_000) return this.backendToken.token;
    try {
      const t = await this.request<{ token: string; expires_at: string }>("POST", "/v1/session/token");
      this.backendToken = { token: t.token, expiresAt: Date.parse(t.expires_at) };
      return t.token;
    } catch (e) {
      if (e instanceof AosError && e.status === 401) return null;
      throw e;
    }
  }

  /** fetch for your own backend: adds "Authorization: Bearer <token>". */
  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return this.fetchFn(input, { ...init, headers });
  }

  async signOut(): Promise<void> {
    try { await this.request("POST", "/v1/sign-out"); } finally { await this.forget(); }
  }

  async signOutEverywhere(): Promise<void> {
    try { await this.request("POST", "/v1/sign-out-all"); } finally { await this.forget(); }
  }

  listSessions() { return this.request<DeviceSession[]>("GET", "/v1/sessions"); }
  endSession(id: string) { return this.request("DELETE", `/v1/sessions/${encodeURIComponent(id)}`); }

  // ------------------------------------------------------------------
  // Sign-up and sign-in
  // ------------------------------------------------------------------

  /** Always resolves the same way, whether or not the address has an account. */
  async signUp(input: { email: string; password: string; name?: string }): Promise<{ status: "check_email" }> {
    await this.request("POST", "/v1/sign-up", input);
    return { status: "check_email" };
  }

  /** The token from the confirmation link. Signs the person in. */
  async verifyEmail(token: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/verify-email", { token }));
  }

  async signIn(input: { email: string; password: string }): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/sign-in", { ...input, session_kind: this.sessionKind }));
  }

  /** Finishes a sign-in that asked for a second factor. */
  async secondFactor(input: { method: "totp" | "recovery_code"; code: string } | { method: "passkey" }): Promise<SignInResult> {
    const pending = await this.storage.getItem(KEY_PENDING);
    if (!pending) throw new AosError(401, "signin_expired", "please sign in again");
    if (input.method === "passkey") {
      const { challenge_id, credential } = await this.passkeyAssertion();
      return this.adopt(await this.request("POST", "/v1/second-factor", { pending_token: pending, method: "passkey", challenge_id, credential }));
    }
    return this.adopt(await this.request("POST", "/v1/second-factor", { pending_token: pending, ...input }));
  }

  /** Emails a 6-digit code and a link. Always resolves the same way. */
  async sendCode(email: string): Promise<void> {
    await this.request("POST", "/v1/code/send", { email });
  }

  async verifyCode(email: string, code: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/code/verify", { email, code, session_kind: this.sessionKind }));
  }

  /** The token from a magic link. */
  async magicLink(token: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/magic-link", { token, session_kind: this.sessionKind }));
  }

  /** Finishes an account an admin made: the token from the setup link. */
  async setupAccount(token: string, password: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/account/setup", { token, password }));
  }

  /** A guest session, for visitors who act before they sign up. */
  async signInAsGuest(name?: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/guest", name ? { name } : {}));
  }

  /** Turns the guest into an account; a confirmation email follows. */
  async upgradeGuest(input: { email: string; password: string; name?: string }): Promise<void> {
    await this.request("POST", "/v1/guest/upgrade", input);
  }

  // ------------------------------------------------------------------
  // Social and enterprise sign-in (redirect flows)
  // ------------------------------------------------------------------

  /** Returns the provider's address; send the browser there. */
  async startSocial(provider: string, redirectUri: string): Promise<string> {
    const r = await this.request<{ authorization_url: string }>("POST", `/v1/oauth/${encodeURIComponent(provider)}/start`, { redirect_uri: redirectUri, session_kind: this.sessionKind });
    return r.authorization_url;
  }

  /** On the redirect page: the state and code the provider sent back. */
  async finishSocial(provider: string, params: { state: string; code: string }): Promise<SignInResult> {
    return this.adopt(await this.request("POST", `/v1/oauth/${encodeURIComponent(provider)}/finish`, params));
  }

  /** Company sign-in by work email. Returns the identity provider's address. */
  async startSSO(email: string, redirectUri: string): Promise<string> {
    const r = await this.request<{ authorization_url: string }>("POST", "/v1/sso/start", { email, redirect_uri: redirectUri, session_kind: this.sessionKind });
    return r.authorization_url;
  }

  async finishSSO(params: { state: string; code: string }): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/sso/finish", params));
  }

  // ------------------------------------------------------------------
  // Passwords and email
  // ------------------------------------------------------------------

  async forgotPassword(email: string): Promise<void> { await this.request("POST", "/v1/password/forgot", { email }); }
  async resetPassword(token: string, password: string): Promise<void> { await this.request("POST", "/v1/password/reset", { token, password }); }
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request("POST", "/v1/password/change", { current_password: currentPassword, new_password: newPassword });
  }
  async changeEmail(newEmail: string, password: string): Promise<void> { await this.request("POST", "/v1/email/change", { new_email: newEmail, password }); }
  async confirmEmail(token: string): Promise<User> { return this.request<User>("POST", "/v1/email/confirm", { token }); }

  // ------------------------------------------------------------------
  // Second factors
  // ------------------------------------------------------------------

  factors() { return this.request<Factors>("GET", "/v1/me/factors"); }
  /** Returns the secret and an otpauth:// URI to show as a QR code. */
  enrollTotp() { return this.request<{ secret: string; uri: string }>("POST", "/v1/me/totp"); }
  /** Confirms the app with a code from it; returns recovery codes, shown once. */
  async confirmTotp(code: string): Promise<string[]> { return (await this.request<{ codes: string[] }>("POST", "/v1/me/totp/confirm", { code })).codes; }
  async disableTotp(code: string): Promise<void> { await this.request("POST", "/v1/me/totp/disable", { code }); }
  async regenerateRecoveryCodes(code: string): Promise<string[]> { return (await this.request<{ codes: string[] }>("POST", "/v1/me/recovery-codes", { code })).codes; }
  /** Makes the second factor fresh, for a permission that needs a step-up. */
  async stepUp(code: string, method: "totp" | "recovery_code" = "totp"): Promise<void> { await this.request("POST", "/v1/step-up", { code, method }); }

  // ------------------------------------------------------------------
  // Passkeys
  // ------------------------------------------------------------------

  private credentials(): CredentialsContainer {
    if (typeof navigator === "undefined" || !navigator.credentials) throw new AosError(0, "passkeys_unsupported", "this environment has no passkey support");
    return navigator.credentials;
  }

  /** Adds a passkey for the signed-in person. */
  async addPasskey(name?: string): Promise<Passkey> {
    const ch = await this.request<{ challenge_id: string; options: unknown }>("POST", "/v1/me/passkeys/options");
    const cred = (await this.credentials().create(creationOptions(ch.options))) as PublicKeyCredential | null;
    if (!cred) throw new AosError(0, "passkey_cancelled", "no passkey was created");
    return this.request<Passkey>("POST", "/v1/me/passkeys", { challenge_id: ch.challenge_id, name: name ?? "", credential: serializeCredential(cred) });
  }

  listPasskeys() { return this.request<Passkey[]>("GET", "/v1/me/passkeys"); }
  removePasskey(id: string) { return this.request("DELETE", `/v1/me/passkeys/${encodeURIComponent(id)}`); }

  private async passkeyAssertion(): Promise<{ challenge_id: string; credential: Record<string, unknown> }> {
    const ch = await this.request<{ challenge_id: string; options: unknown }>("POST", "/v1/passkey/options");
    const cred = (await this.credentials().get(requestOptions(ch.options))) as PublicKeyCredential | null;
    if (!cred) throw new AosError(0, "passkey_cancelled", "no passkey was chosen");
    return { challenge_id: ch.challenge_id, credential: serializeCredential(cred) };
  }

  /** Signs in with a passkey; no email is typed. */
  async signInWithPasskey(): Promise<SignInResult> {
    const a = await this.passkeyAssertion();
    return this.adopt(await this.request("POST", "/v1/passkey/sign-in", { ...a, session_kind: this.sessionKind }));
  }

  // ------------------------------------------------------------------
  // Organizations
  // ------------------------------------------------------------------

  listOrganizations() { return this.request<Organization[]>("GET", "/v1/organizations"); }
  async createOrganization(name: string, slug?: string): Promise<Organization> {
    const org = await this.request<Organization>("POST", "/v1/organizations", { name, slug });
    await this.getSession(true);
    this.backendToken = null;
    return org;
  }
  /** Makes the organization active: the backend token then carries it. */
  async switchOrganization(id: string): Promise<void> {
    await this.request("POST", `/v1/organizations/${encodeURIComponent(id)}/switch`);
    this.backendToken = null;
    await this.getSession(true);
  }
  listMembers(orgId: string) { return this.request<Member[]>("GET", `/v1/organizations/${encodeURIComponent(orgId)}/members`); }
  changeMemberRole(orgId: string, principalId: string, role: string) {
    return this.request("PUT", `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(principalId)}/role`, { role });
  }
  removeMember(orgId: string, principalId: string) {
    return this.request("DELETE", `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(principalId)}`);
  }
  invite(orgId: string, email: string, role: string) { return this.request<Invitation>("POST", `/v1/organizations/${encodeURIComponent(orgId)}/invitations`, { email, role }); }
  listInvitations(orgId: string) { return this.request<Invitation[]>("GET", `/v1/organizations/${encodeURIComponent(orgId)}/invitations`); }
  previewInvitation(token: string) { return this.request<InvitationPreview>("GET", `/v1/invitations/${encodeURIComponent(token)}`); }
  acceptInvitation(token: string) { return this.request<Organization>("POST", "/v1/invitations/accept", { token }); }
  declineInvitation(token: string) { return this.request("POST", "/v1/invitations/decline", { token }); }
  async signUpWithInvitation(token: string, password: string, name?: string): Promise<SignInResult> {
    return this.adopt(await this.request("POST", "/v1/invitations/sign-up", { token, password, name }));
  }

  // ------------------------------------------------------------------
  // Account
  // ------------------------------------------------------------------

  async exportAccount(password: string) { return this.request("POST", "/v1/me/export", { password }); }
  async deleteAccount(password: string): Promise<void> {
    await this.request("DELETE", "/v1/me", { password });
    await this.forget();
  }
}

export function createClient(opts: ClientOptions): AosClient {
  return new AosClient(opts);
}

export type { SessionInfo };
