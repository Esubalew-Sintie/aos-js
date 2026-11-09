// The engine run by the application itself (startLocal), against a real
// database: ../scripts/with-engine.sh node --test test-integration/local.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startLocal } from "@aos-auth/node";

const engine = process.env.AOS_IT_ENGINE;
const skip = !engine && "run through sdk/scripts/with-engine.sh";

test("an application runs its own engine: browser routes through its server, backend calls in-process", { skip }, async () => {
  const local = await startLocal({
    databaseUrl: process.env.AOS_IT_DATABASE_URL, masterKey: process.env.AOS_IT_MASTER_KEY,
    appUrl: "http://shop.test", development: true, engine, slug: "node-local", log: "ignore",
  });
  try {
    assert.match(local.publishableKey, /^pk_/);
    // The application's server: /aos/* goes to the engine.
    const mount = local.handler();
    const app = createServer((req, res) => mount(req, res, () => { res.statusCode = 404; res.end("app route"); }));
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${app.address().port}`;
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method, headers: { "Content-Type": "application/json", Origin: "http://shop.test", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null; try { json = await res.json(); } catch {}
      return { status: res.status, json };
    };

    const email = `local-${Date.now()}@shop.test`;
    assert.equal((await call("POST", "/aos/v1/sign-up", { email, password: "correct horse battery staple 42" })).status, 202);
    assert.equal((await call("POST", "/aos/v1/sign-up", { email: "x@y.test", password: "correct horse battery staple 42" }, { Origin: "http://evil.test" })).status, 403);
    let token = "";
    for (let i = 0; i < 50 && !token; i++) {
      const mail = await call("GET", `/aos/dev/mail?to=${encodeURIComponent(email)}`);
      token = mail.json?.data?.[0]?.token ?? "";
      if (!token) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(token, "the confirmation email reached the development inbox");
    const verified = await call("POST", "/aos/v1/verify-email", { token });
    const session = verified.json.data.session_token;
    const userId = verified.json.data.user.id;
    const jwt = (await call("POST", "/aos/v1/session/token", undefined, { "X-AOS-Session": session })).json.data.token;

    // The backend side: the SDK client talks to the engine with the one-time key.
    const claims = await local.aos.verifyToken(jwt);
    assert.equal(claims.userId, userId);
    await local.aos.permissions.put({ name: "invoice.read" });
    await local.aos.roles.put({ name: "Viewer", permissions: ["invoice.read"] });
    const ask = () => local.aos.can({ principal_id: userId, permission: "invoice.read", resource: { type: "tenant", id: "root" } });
    assert.equal((await ask()).allowed, false);
    await local.aos.grants.create({ principal_id: userId, role: "Viewer", resource: { type: "tenant", id: "root" } });
    assert.equal((await ask()).allowed, true);

    // A browser cannot pass for the backend, and a wrong key opens nothing.
    const forged = await call("POST", "/aos/v1/can", { principal_id: userId, permission: "invoice.read", resource: { type: "tenant", id: "root" } }, { Authorization: "Bearer sk_local_" + "x".repeat(43) });
    assert.notEqual(forged.status, 200);
    const direct = await fetch(local.url + "/v1/can", { method: "POST", headers: { Authorization: "Bearer sk_local_" + "y".repeat(43), "Content-Type": "application/json" }, body: "{}" });
    assert.equal(direct.status, 401);
    assert.equal((await call("GET", "/other")).status, 404, "routes outside /aos stay the application's");

    // The Fetch-API proxy, for Next.js and the like.
    const jwks = await local.fetch(new Request("http://shop.test/aos/v1/jwks.json"));
    assert.equal(jwks.status, 200);
    app.close();
  } finally {
    await local.stop();
  }
});
