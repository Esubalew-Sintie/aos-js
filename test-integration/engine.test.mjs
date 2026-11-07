// Runs against a real engine. Start it with:
//   ../scripts/with-engine.sh npm run test:integration
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isAosError } from "@aos-auth/js";
import { Aos, InvalidTokenError, canHandler } from "@aos-auth/node";

const URL_ = process.env.AOS_IT_URL;
const PK = process.env.AOS_IT_PUBLISHABLE_KEY;
const SK = process.env.AOS_IT_SECRET_KEY;
if (!URL_ || !PK || !SK) throw new Error("run through sdk/scripts/with-engine.sh");

class Mem { constructor() { this.m = new Map(); } getItem(k) { return this.m.get(k) ?? null; } setItem(k, v) { this.m.set(k, v); } removeItem(k) { this.m.delete(k); } }

const server = new Aos({ url: URL_, publishableKey: PK, secretKey: SK });

async function mailFor(email, pred = () => true) {
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${URL_}/dev/mail?to=${encodeURIComponent(email)}`);
    const { data } = await res.json();
    const m = (data ?? []).find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no email for " + email);
}

const password = "correct horse battery staple 42";

async function signedUpUser(kind = "browser") {
  const email = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const aos = createClient({ url: URL_, publishableKey: PK, storage: new Mem(), sessionKind: kind });
  assert.deepEqual(await aos.signUp({ email, password, name: "Ita" }), { status: "check_email" });
  const mail = await mailFor(email, (m) => m.links.some((l) => l.includes("/auth/verify-email")));
  assert.ok(mail.token, "the email carries a token");
  const r = await aos.verifyEmail(mail.token);
  assert.equal(r.status, "signed_in");
  return { aos, email, user: r.user };
}

test("browser client: sign up, verify, session, backend token verified by the node SDK", async () => {
  const { aos, email, user } = await signedUpUser();
  const s = await aos.getSession(true);
  assert.equal(s.user.email, email);

  const token = await aos.getToken();
  assert.ok(token);
  const claims = await server.verifyToken(token);
  assert.equal(claims.userId, user.id);
  assert.equal(claims.sessionId, s.session.id);
  await assert.rejects(server.verifyToken(token.slice(0, -4) + "AAAA"), InvalidTokenError);

  // Sign out, then sign in with the password.
  await aos.signOut();
  assert.equal(await aos.getSession(true), null);
  await assert.rejects(aos.signIn({ email, password: "wrong password here" }), (e) => isAosError(e, "invalid_credentials"));
  const again = await aos.signIn({ email, password });
  assert.equal(again.status, "signed_in");
});

test("permissions from the node SDK, answered for a signed-in person, and canHandler", async () => {
  const { aos, user } = await signedUpUser();
  await server.permissions.put({ name: "invoice.read", description: "Read invoices" });
  await server.permissions.put({ name: "invoice.refund", description: "Refund", step_up_seconds: 300 });
  await server.roles.put({ name: "Billing", permissions: ["invoice.read"] });
  await server.resources.put({ type: "invoice", id: "inv-1" });

  const catalog = await server.permissions.list();
  assert.ok(catalog.some((p) => p.name === "invoice.refund" && p.step_up_seconds === 300));
  assert.ok((await server.roles.list()).some((r) => r.name === "Billing" && r.permissions.includes("invoice.read")));

  const ask = (permission) => server.can({ principal_id: user.id, permission, resource: { type: "invoice", id: "inv-1" } });
  assert.equal((await ask("invoice.read")).allowed, false);
  const grantId = await server.grants.create({ principal_id: user.id, role: "Billing", resource: { type: "tenant", id: "root" } });
  assert.equal((await ask("invoice.read")).allowed, true);
  assert.equal((await ask("invoice.refund")).allowed, false);
  const f = await server.filter(user.id, "invoice.read", "invoice");
  assert.ok(f.allowed.includes("inv-1"));

  const handler = canHandler(server);
  const res = await handler(new Request("http://app/api/aos/can", {
    method: "POST",
    headers: { Authorization: "Bearer " + (await aos.getToken()) },
    body: JSON.stringify({ permissions: ["invoice.read", "invoice.refund"], resource: { type: "invoice", id: "inv-1" } }),
  }));
  assert.deepEqual(await res.json(), { results: { "invoice.read": true, "invoice.refund": false } });

  await server.grants.delete(grantId);
  assert.equal((await ask("invoice.read")).allowed, false);
});

test("token sessions (mobile): access token, refresh, backend token", async () => {
  const { email } = await signedUpUser();
  const storage = new Mem();
  const mobile = createClient({ url: URL_, publishableKey: PK, sessionKind: "token", storage });
  const r = await mobile.signIn({ email, password });
  assert.equal(r.status, "signed_in");
  assert.ok(storage.getItem("aos.access") && storage.getItem("aos.refresh"));

  // A broken access token is replaced through the refresh token.
  storage.setItem("aos.access", "broken");
  const s = await mobile.getSession(true);
  assert.equal(s.user.email, email);
  assert.notEqual(storage.getItem("aos.access"), "broken");

  const claims = await server.verifyToken(await mobile.getToken());
  assert.equal(claims.userId, s.user.id);
  await mobile.signOut();
  assert.equal(storage.getItem("aos.refresh"), null);
});

test("organizations: create, switch, the token carries it", async () => {
  const { aos } = await signedUpUser();
  const org = await aos.createOrganization("Acme " + Date.now().toString(36));
  await aos.switchOrganization(org.id);
  const claims = await server.verifyToken(await aos.getToken());
  assert.ok(claims.organization, "the token names the active organization");
  const members = await aos.listMembers(org.id);
  assert.equal(members.length, 1);
});

test("admin users and the email code sign-in", async () => {
  const email = `code-${Date.now()}@example.com`;
  const u = await server.users.create({ email, name: "Coda" });
  assert.equal((await server.users.get(u.id)).email, email);
  const page = await server.users.list({ limit: 200 });
  assert.ok(page.users.some((x) => x.id === u.id));

  // The person finishes the account from the setup email.
  const aos = createClient({ url: URL_, publishableKey: PK, storage: new Mem() });
  const setup = await mailFor(email, (m) => m.links.some((l) => l.includes("/auth/setup")));
  const done = await aos.setupAccount(setup.token, password);
  assert.equal(done.status, "signed_in");
  await aos.signOut();

  // Then signs in with a code from email.
  await aos.sendCode(email);
  const mail = await mailFor(email, (m) => !!m.code);
  const r = await aos.verifyCode(email, mail.code);
  assert.equal(r.status, "signed_in");
  assert.equal(r.user.id, u.id);
});
