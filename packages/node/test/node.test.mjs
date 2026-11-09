import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { Aos, InvalidTokenError, BadSignatureError, verifyWebhook, signWebhook, requireAuth, requirePermission, canHandler, getAuth, tokenFromHeaders } from "../dist/index.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const jwk = publicKey.export({ format: "jwk" });
const other = generateKeyPairSync("ed25519");

function token(claims, { key = privateKey, kid = "k1", alg = "EdDSA" } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg, kid, typ: "JWT" }) + "." + enc(claims);
  return head + "." + sign(null, Buffer.from(head), key).toString("base64url");
}

const NOW = 1_800_000_000_000;
const base = { sub: "user-1", sid: "sess-1", tid: "ten-1", aal: 1, iat: NOW / 1000, exp: NOW / 1000 + 60 };

// A fake engine: serves the keys and answers /v1/can and /v1/can/batch.
function fakeEngine({ allow = () => true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/v1/jwks.json") {
      if (init.headers?.["X-AOS-Publishable-Key"] !== "pk_test_1") return json(401, {});
      return json(200, { keys: [{ ...jwk, kid: "k1" }] });
    }
    if (init.headers?.Authorization !== "Bearer sk_test_1") return json(401, { status: "error", error: { code: "invalid_key", message: "no" } });
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === "/v1/can") {
      const ok = allow(body);
      return json(200, { status: "success", data: { allowed: ok, reason: ok ? "allowed" : "no_matching_grant" } });
    }
    if (path === "/v1/can/batch") return json(200, { data: { results: body.checks.map((c) => ({ allowed: allow(c), reason: "x" })) } });
    if (path === "/v1/users/missing") return json(404, { status: "error", error: { code: "not_found", message: "user not found" } });
    return json(404, {});
  };
  return { fetch, calls };
}

const make = (engine) => new Aos({ url: "http://engine.test/", publishableKey: "pk_test_1", secretKey: "sk_test_1", fetch: engine.fetch, now: () => NOW });

test("verifyToken accepts a good token and returns its claims", async () => {
  const aos = make(fakeEngine());
  const c = await aos.verifyToken(token({ ...base, org: "acme", org_id: "r-1", typ: "access" }));
  assert.equal(c.userId, "user-1");
  assert.equal(c.sessionId, "sess-1");
  assert.equal(c.organization, "acme");
  assert.equal(c.organizationId, "r-1");
  assert.equal(c.assuranceLevel, 1);
});

test("verifyToken refuses tampered, foreign, expired and malformed tokens", async () => {
  const aos = make(fakeEngine());
  const good = token(base);
  const [h, , s] = good.split(".");
  const forged = h + "." + Buffer.from(JSON.stringify({ ...base, sub: "admin" })).toString("base64url") + "." + s;
  const cases = [
    forged,
    token(base, { key: other.privateKey }),
    token({ ...base, exp: NOW / 1000 - 61 }),
    token(base, { alg: "none" }),
    token(base, { kid: "unknown" }),
    token({ ...base, sub: "" }),
    "a.b",
    "",
  ];
  for (const t of cases) await assert.rejects(aos.verifyToken(t), InvalidTokenError);
  // Within a minute of skew it still passes.
  await aos.verifyToken(token({ ...base, exp: NOW / 1000 - 30 }));
});

test("public keys are fetched once and refetched for an unknown key at most every 10 s", async () => {
  const engine = fakeEngine();
  let now = NOW;
  const aos = new Aos({ url: "http://engine.test", publishableKey: "pk_test_1", fetch: engine.fetch, now: () => now });
  for (let i = 0; i < 3; i++) await aos.verifyToken(token(base));
  const jwksCalls = () => engine.calls.filter((c) => c.path === "/v1/jwks.json").length;
  assert.equal(jwksCalls(), 1);
  await assert.rejects(aos.verifyToken(token(base, { kid: "new" })), InvalidTokenError);
  assert.equal(jwksCalls(), 1, "an unknown kid right after a fetch must not refetch");
  now += 11_000;
  await assert.rejects(aos.verifyToken(token(base, { kid: "new" })), InvalidTokenError);
  assert.equal(jwksCalls(), 2);
});

test("backend calls send the secret key and turn errors into AosError", async () => {
  const aos = make(fakeEngine());
  const r = await aos.can({ principal_id: "u", permission: "a.b", resource: { type: "tenant", id: "root" } });
  assert.deepEqual(r, { allowed: true, reason: "allowed" });
  await assert.rejects(aos.users.get("missing"), (e) => e.name === "AosError" && e.code === "not_found" && e.status === 404);
  assert.throws(() => new Aos({ url: "x", secretKey: "pk_wrong" }), /secret key/);
  await assert.rejects(new Aos({ url: "http://x" }).can({}), /secretKey/);
});

test("webhook signatures: good, wrong secret, old, tampered", () => {
  const body = JSON.stringify({ id: "ev1", event: "user.created", created_at: "2026-01-01T00:00:00Z", data: { id: "u1" } });
  const header = signWebhook("whsec_1", body, NOW);
  assert.equal(verifyWebhook("whsec_1", header, body, 300, NOW).event, "user.created");
  assert.equal(verifyWebhook("whsec_1", header, Buffer.from(body), 300, NOW).id, "ev1");
  assert.throws(() => verifyWebhook("whsec_2", header, body, 300, NOW), BadSignatureError);
  assert.throws(() => verifyWebhook("whsec_1", header, body, 300, NOW + 301_000), BadSignatureError);
  assert.throws(() => verifyWebhook("whsec_1", header, body.replace("u1", "u2"), 300, NOW), BadSignatureError);
  assert.throws(() => verifyWebhook("whsec_1", "", body, 300, NOW), BadSignatureError);
  // A rotated secret: two v1 signatures, either may match.
  const second = signWebhook("whsec_old", body, NOW).split(",")[1];
  assert.equal(verifyWebhook("whsec_old", header + "," + second, body, 300, NOW).id, "ev1");
});

function mockRes() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("express: requireAuth and requirePermission", async () => {
  const aos = make(fakeEngine({ allow: (c) => c.permission === "invoice.read" && c.resource.id === "acme" && c.session_id === "sess-1" }));
  const run = async (mw, req) => {
    const res = mockRes();
    let passed = false;
    await mw(req, res, () => { passed = true; });
    return { res, passed };
  };
  let r = await run(requireAuth(aos), { headers: {} });
  assert.equal(r.res.code, 401);
  r = await run(requireAuth(aos), { headers: { authorization: "Bearer junk" } });
  assert.equal(r.res.code, 401);
  r = await run(requireAuth(aos, { optional: true }), { headers: { authorization: "Bearer junk" } });
  assert.ok(r.passed);

  const req = { headers: { authorization: "Bearer " + token({ ...base, org: "acme" }) } };
  r = await run(requireAuth(aos), req);
  assert.ok(r.passed);
  assert.equal(req.aos.userId, "user-1");
  assert.ok((await run(requirePermission(aos, "invoice.read"), req)).passed);
  r = await run(requirePermission(aos, "invoice.delete"), req);
  assert.equal(r.res.code, 403);
  assert.equal(r.res.body.error.code, "no_matching_grant");
});

test("getAuth and canHandler for Fetch-API frameworks", async () => {
  const aos = make(fakeEngine({ allow: (c) => c.permission === "invoice.read" }));
  const t = token(base);
  assert.equal(await getAuth(aos, new Request("http://app/x")), null);
  assert.equal((await getAuth(aos, new Request("http://app/x", { headers: { Authorization: "Bearer " + t } }))).userId, "user-1");
  assert.equal(tokenFromHeaders({ Authorization: "Bearer abc" }), "abc");

  const handler = canHandler(aos);
  let res = await handler(new Request("http://app/api/aos/can", { method: "POST", body: "{}" }));
  assert.equal(res.status, 401);
  res = await handler(new Request("http://app/api/aos/can", {
    method: "POST", headers: { Authorization: "Bearer " + t }, body: JSON.stringify({ permissions: ["invoice.read", "invoice.delete", 5] }),
  }));
  assert.deepEqual(await res.json(), { results: { "invoice.read": true, "invoice.delete": false } });
});

test("express canMiddleware", async () => {
  const { canMiddleware } = await import("../dist/index.js");
  const aos = make(fakeEngine({ allow: (c) => c.permission === "invoice.read" && c.resource.id === "acme" }));
  const mw = canMiddleware(aos);
  let res = mockRes();
  await mw({ headers: {}, body: { permissions: ["invoice.read"] } }, res);
  assert.equal(res.code, 401);
  res = mockRes();
  await mw({ headers: { authorization: "Bearer " + token({ ...base, org: "acme" }) }, body: { permissions: ["invoice.read", "invoice.refund"] } }, res);
  assert.deepEqual(res.body, { results: { "invoice.read": true, "invoice.refund": false } });
});

test("downloadEngine checks the checksum and caches the program", async () => {
  const { downloadEngine } = await import("../dist/index.js");
  const { createServer } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  if (process.platform === "win32") return;
  // A tar.gz holding ./aos, built by hand.
  const body = Buffer.from("#!/bin/sh\necho engine\n");
  const header = Buffer.alloc(512);
  header.write("./aos", 0); header.write("0000755\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
  header.write("        ", 148); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
  let sum = 0; for (const b of header) sum += b; header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const tar = Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]);
  const archive = gzipSync(tar);
  const os = { linux: "linux", darwin: "darwin" }[process.platform], arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  const asset = `aos_v9.9.9_${os}_${arch}.tar.gz`;
  let good = true, hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/v9.9.9/checksums.txt") return res.end(`${createHash("sha256").update(archive).digest("hex")}  ${asset}\n`);
    if (req.url === "/v9.9.9/" + asset) return res.end(good ? archive : Buffer.concat([archive, Buffer.from([0])]));
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.AOSCTL_RELEASES_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    process.env.AOSCTL_CACHE_DIR = mkdtempSync(join(tmpdir(), "aos-cache-"));
    good = false;
    await assert.rejects(downloadEngine("v9.9.9"), /checksum/);
    good = true;
    const path = await downloadEngine("v9.9.9");
    assert.deepEqual(readFileSync(path), body);
    const before = hits;
    assert.equal(await downloadEngine("v9.9.9"), path);
    assert.equal(hits, before, "the second call uses the cache");
    await assert.rejects(downloadEngine("v1.0.0"), /404/);
  } finally {
    server.close();
    delete process.env.AOSCTL_RELEASES_URL;
    delete process.env.AOSCTL_CACHE_DIR;
  }
});
