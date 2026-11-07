import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, AosError, isAosError, toBase64url, fromBase64url } from "../dist/index.js";

class Mem { constructor() { this.m = new Map(); } getItem(k) { return this.m.get(k) ?? null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }

const user = { id: "u1", email: "a@x.test", status: "active", email_verified: true, assurance_level: 1, created_at: "" };
const session = { id: "s1", expires_at: "" };

// A scripted engine: routes map "METHOD path" to (body, headers) => [status, data | {error}].
function engine(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ key, body, headers, init });
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ status: "error", error: { code: "not_found", message: key } }), { status: 404 });
    const [status, payload] = h(body, headers, calls.length);
    const envelope = payload?.error ? { status: "error", error: payload.error } : { status: "success", data: payload };
    return new Response(JSON.stringify(envelope), { status });
  };
  return { fetch, calls };
}

test("options are checked", () => {
  assert.throws(() => createClient({ url: "http://x", publishableKey: "sk_live_1" }), /publishable/);
  assert.throws(() => createClient({ url: "", publishableKey: "pk_1" }), /url/);
});

test("development sign-in keeps the session and sends it in a header", async () => {
  const e = engine({
    "POST /v1/sign-in": (b) => [200, { user, session, session_token: "devtok" }],
    "GET /v1/session": (b, h) => h["x-aos-session"] === "devtok" ? [200, { user, session }] : [401, { error: { code: "unauthenticated" } }],
  });
  const storage = new Mem();
  const aos = createClient({ url: "http://engine/", publishableKey: "pk_test_1", storage, fetch: e.fetch });
  const seen = [];
  aos.onChange((s) => seen.push(s?.user.id ?? null));
  const r = await aos.signIn({ email: "a@x.test", password: "pw" });
  assert.equal(r.status, "signed_in");
  assert.equal(e.calls[0].body.session_kind, "browser");
  assert.equal(e.calls[0].headers["x-aos-publishable-key"], "pk_test_1");
  assert.equal(e.calls[0].init.credentials, "include");
  assert.equal(storage.getItem("aos.session"), "devtok");
  const s = await aos.getSession(true);
  assert.equal(s.user.id, "u1");
  assert.deepEqual(seen, ["u1", "u1"]);
});

test("second factor: the pending token is kept and used", async () => {
  const e = engine({
    "POST /v1/sign-in": () => [200, { second_factor_required: true, pending_token: "pend", methods: ["totp", "recovery_code"] }],
    "POST /v1/second-factor": (b) => b.pending_token === "pend" && b.code === "123456" ? [200, { user, session, session_token: "t2" }] : [401, { error: { code: "wrong_code", message: "wrong" } }],
  });
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", storage: new Mem(), fetch: e.fetch });
  const r = await aos.signIn({ email: "a", password: "b" });
  assert.deepEqual(r, { status: "second_factor", methods: ["totp", "recovery_code"] });
  await assert.rejects(aos.secondFactor({ method: "totp", code: "000000" }), (err) => isAosError(err, "wrong_code") && err.status === 401);
  const done = await aos.secondFactor({ method: "totp", code: "123456" });
  assert.equal(done.status, "signed_in");
  await assert.rejects(aos.secondFactor({ method: "totp", code: "123456" }), /sign in again/);
});

test("getToken is cached until 10 s before expiry; fetch adds it", async () => {
  let n = 0;
  const e = engine({
    "POST /v1/session/token": () => [200, { token: "jwt" + ++n, expires_at: new Date(Date.now() + (n === 1 ? 60_000 : 5_000)).toISOString() }],
  });
  const appCalls = [];
  const fetchFn = async (url, init) => {
    if (String(url).startsWith("http://engine")) return e.fetch(url, init);
    appCalls.push(new Headers(init.headers).get("authorization"));
    return new Response("ok");
  };
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", storage: new Mem(), fetch: fetchFn });
  assert.equal(await aos.getToken(), "jwt1");
  assert.equal(await aos.getToken(), "jwt1");
  await aos.fetch("http://app/api/x");
  assert.deepEqual(appCalls, ["Bearer jwt1"]);
  assert.equal(n, 1);
});

test("getToken is null when signed out; other errors throw AosError", async () => {
  const e = engine({ "POST /v1/session/token": () => [401, { error: { code: "unauthenticated", message: "no" } }] });
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", storage: new Mem(), fetch: e.fetch });
  assert.equal(await aos.getToken(), null);
  const e2 = engine({ "POST /v1/sign-up": () => [429, { error: { code: "rate_limited", message: "slow down", details: { retry_after: "5" } } }] });
  const aos2 = createClient({ url: "http://engine", publishableKey: "pk_1", storage: new Mem(), fetch: e2.fetch });
  await assert.rejects(aos2.signUp({ email: "a", password: "b" }), (err) => err instanceof AosError && err.code === "rate_limited" && err.details.retry_after === "5");
});

test("token sessions: bearer access token, refresh on 401, retry once", async () => {
  const e = engine({
    "POST /v1/sign-in": (b) => [200, { user, session, access_token: "a1", refresh_token: "r1", expires_in: 900 }],
    "GET /v1/session": (b, h) => h.authorization === "Bearer a2" ? [200, { user, session }] : [401, { error: { code: "unauthenticated" } }],
    "POST /v1/token/refresh": (b) => b.refresh_token === "r1" ? [200, { user, session, access_token: "a2", refresh_token: "r2" }] : [401, { error: { code: "invalid_token" } }],
  });
  const storage = new Mem();
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", sessionKind: "token", storage, fetch: e.fetch });
  await aos.signIn({ email: "a", password: "b" });
  assert.equal(e.calls[0].body.session_kind, "token");
  const s = await aos.getSession(true);
  assert.equal(s.user.id, "u1");
  assert.equal(storage.getItem("aos.refresh"), "r2");
  assert.deepEqual(e.calls.map((c) => c.key), ["POST /v1/sign-in", "GET /v1/session", "POST /v1/token/refresh", "GET /v1/session"]);
});

test("a refresh that fails signs the person out", async () => {
  const e = engine({
    "GET /v1/session": () => [401, { error: { code: "unauthenticated" } }],
    "POST /v1/token/refresh": () => [401, { error: { code: "invalid_token" } }],
  });
  const storage = new Mem();
  storage.setItem("aos.access", "old");
  storage.setItem("aos.refresh", "gone");
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", sessionKind: "token", storage, fetch: e.fetch });
  assert.equal(await aos.getSession(true), null);
  assert.equal(storage.getItem("aos.refresh"), null);
  assert.equal(storage.getItem("aos.access"), null);
});

test("signOut forgets the session even if the engine call fails", async () => {
  const e = engine({ "POST /v1/sign-out": () => [500, { error: { code: "unexpected", message: "boom" } }] });
  const storage = new Mem();
  storage.setItem("aos.session", "devtok");
  const aos = createClient({ url: "http://engine", publishableKey: "pk_1", storage, fetch: e.fetch });
  await assert.rejects(aos.signOut());
  assert.equal(storage.getItem("aos.session"), null);
});

test("base64url round-trips bytes", () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
  const s = toBase64url(bytes);
  assert.ok(!/[+/=]/.test(s));
  assert.deepEqual(new Uint8Array(fromBase64url(s)), bytes);
});
