# @aos-auth/node

AOS for Node backends: verify session tokens, check permissions, guard routes, manage users, roles, organizations, API keys and webhooks. Helpers for Express and for frameworks built on `Request`/`Response` (Next.js route handlers, Hono, Remix). It can also run the AOS engine on your own Postgres, with no separate auth server to deploy (`startLocal`).

> Part of **AOS**, an identity and access platform. Source: [aos-js](https://github.com/flash-software-technology/aos-js).

## Where it fits

| Piece | Job |
| --- | --- |
| [`@aos-auth/react`](https://www.npmjs.com/package/@aos-auth/react) / [`@aos-auth/js`](https://www.npmjs.com/package/@aos-auth/js) | The browser: signs people in with the publishable key, sends your backend a short-lived token. |
| **`@aos-auth/node`** (this) | Your server: checks that token, asks the engine about permissions with the secret key, runs admin tasks. |
| [aos](https://github.com/flash-software-technology/aos) engine, [aosctl](https://github.com/flash-software-technology/aos-cli) | The server that holds users and permissions, and the CLI that runs it locally (`aosctl dev`). |

Other backends: [aos-go](https://github.com/flash-software-technology/aos-go), [aos-python](https://github.com/flash-software-technology/aos-python).

## Install

```sh
npm install @aos-auth/node
```

Node 18 or newer. ES module with TypeScript types, no dependencies (Express is not required).

You need an engine and two keys. For development, `aosctl dev` (from [aos-cli](https://github.com/flash-software-technology/aos-cli)) starts one and writes them to `.env`:

```sh
AOS_URL=http://127.0.0.1:8080
AOS_PUBLISHABLE_KEY=pk_test_...     # lets the SDK fetch the engine's public keys to verify tokens
AOS_SECRET_KEY=sk_test_...          # for backend calls: server only, never in a browser
```

## Quick start (Express)

```js
import express from "express";
import { Aos, requireAuth, requirePermission, activeOrganization, canMiddleware } from "@aos-auth/node";

const aos = new Aos({
  url: process.env.AOS_URL,
  publishableKey: process.env.AOS_PUBLISHABLE_KEY,
  secretKey: process.env.AOS_SECRET_KEY,
});

const app = express();
app.use(express.json());

// Signed in? req.aos holds the token's claims.
app.get("/api/me", requireAuth(aos), (req, res) => {
  res.json({ userId: req.aos.userId, organization: req.aos.organization ?? null });
});

// Signed in AND holds invoice.read in the active organization?
app.get("/api/invoices", requireAuth(aos), requirePermission(aos, "invoice.read", activeOrganization), (req, res) => {
  res.json([{ id: "INV-1001", amount: 1250 }]);
});

// Answers <Protect> in @aos-auth/react.
app.post("/api/aos/can", canMiddleware(aos));

app.listen(4000);
```

```sh
curl -i localhost:4000/api/me
# HTTP/1.1 401 Unauthorized
# {"status":"error","error":{"code":"unauthenticated","message":"sign in to continue"}}
```

The browser calls these routes with `aos.fetch(...)` from `@aos-auth/js` / `useAos().fetch(...)`, which adds `Authorization: Bearer <token>`.

## Common tasks

### Verify a token yourself

```js
import { InvalidTokenError, tokenFromHeaders } from "@aos-auth/node";

try {
  const claims = await aos.verifyToken(tokenFromHeaders(req.headers));
  // { userId, sessionId, tenantId, organization?, organizationId?, assuranceLevel, issuedAt, expiresAt }
} catch (e) {
  if (e instanceof InvalidTokenError) return res.status(401).end();
  throw e;
}
```

Tokens are EdDSA-signed JWTs that live 60 seconds. Verification happens locally against the engine's public keys (JWKS), fetched with the publishable key and cached for 10 minutes (`keysTtlMs`). An unknown key id triggers a refetch, at most every 10 seconds, and known keys keep working if the engine is briefly unreachable. One minute of clock skew is allowed.

### Check a permission

```js
const r = await aos.can({
  principal_id: claims.userId,
  permission: "invoice.refund",
  resource: { type: "invoice", id: "42" },
  session_id: claims.sessionId,           // lets step-up (recent second factor) permissions pass
  context: { request: { amount: 500 } },  // read by grant conditions
});
// { allowed: false, reason: "no_matching_grant" | "step_up_required" | "approval_required" | ... }
```

A "no" is an answer, not an error. Also:

```js
await aos.canBatch([req1, req2]);                          // CanResult[]
await aos.filter(userId, "invoice.read", "invoice");       // { allowed: [ids], conditional: [ids], truncated }
await aos.explain(req1);                                   // why the answer is what it is
```

### Set up permissions, roles, resources and grants

```js
await aos.permissions.put({ name: "invoice.read", description: "See invoices" });
await aos.permissions.put({ name: "invoice.refund", step_up_seconds: 300 });   // needs a second factor in the last 5 min
await aos.roles.put({ name: "Billing", permissions: ["invoice.read", "invoice.refund"] });
await aos.resources.put({ type: "invoice", id: "42" }, { type: "organization", id: "acme" }, "Invoice 42");  // child, parent, display name
const grantId = await aos.grants.create({ principal_id: userId, role: "Billing", resource: { type: "organization", id: "acme" } });
await aos.grants.delete(grantId);
await aos.permissions.list();
await aos.roles.list();
```

Grants also take `effect: "deny"`, `condition`, `expires_at`, `reason`, or a `group_id` instead of `principal_id`. Grants inherit down the resource tree; `{ type: "tenant", id: "root" }` (or `root()`) is the top.

### Users and organizations

```js
const user = await aos.users.create({ email: "sam@example.com", name: "Sam", role: "Viewer" });  // emails a setup link
await aos.users.get(user.id);
const { users, next_cursor } = await aos.users.list({ limit: 50 });
await aos.users.suspend(user.id, "chargeback");
await aos.users.reinstate(user.id);
await aos.users.delete(user.id);

const org = await aos.organizations.create("Acme", "acme", ownerUserId);
await aos.organizations.list();
await aos.organizations.members(org.id);
await aos.organizations.invite(org.id, "ana@example.com", "Billing");
```

### API keys for machines

```js
const k = await aos.apiKeys.create(userId, "nightly-export", ["invoice.read"]);   // k.key: the key itself, store it now
const check = await aos.apiKeys.check(presentedKey, "invoice.read");             // { allowed, principal_id, scopes, ... }
```

### Webhooks

```js
import { verifyWebhook, BadSignatureError } from "@aos-auth/node";

const hook = await aos.webhooks.create("https://shop.example.com/api/webhooks/aos", ["user.created"]);
// hook.secret: store it as AOS_WEBHOOK_SECRET

// The signature covers the raw body: register this BEFORE express.json().
app.post("/api/webhooks/aos", express.raw({ type: "*/*" }), (req, res) => {
  try {
    const event = verifyWebhook(process.env.AOS_WEBHOOK_SECRET, req.get("x-aos-signature"), req.body);
    console.log(event.event, event.id, event.data);
    res.status(204).end();
  } catch (e) {
    if (e instanceof BadSignatureError) return res.status(400).send("bad signature");
    throw e;
  }
});
```

Deliveries older than 300 seconds are refused (5th argument changes it). `signWebhook(secret, rawBody)` makes a valid header for your own tests. In development, `aosctl webhooks listen` forwards events to you.

### Next.js, Hono, Remix (Fetch API)

```ts
// lib/aos.ts
import { Aos } from "@aos-auth/node";
export const aos = new Aos({ url: process.env.AOS_URL!, publishableKey: process.env.AOS_PUBLISHABLE_KEY, secretKey: process.env.AOS_SECRET_KEY });

// app/api/aos/can/route.ts: answers <Protect>
import { canHandler } from "@aos-auth/node";
export const POST = canHandler(aos);

// app/api/invoices/route.ts
import { getAuth } from "@aos-auth/node";
export async function GET(request: Request) {
  const claims = await getAuth(aos, request);              // null when not signed in
  if (!claims) return Response.json({ error: { code: "unauthenticated" } }, { status: 401 });
  const resource = claims.organization ? { type: "organization", id: claims.organization } : { type: "tenant", id: "root" };
  const r = await aos.can({ principal_id: claims.userId, permission: "invoice.read", resource, session_id: claims.sessionId });
  if (!r.allowed) return Response.json({ error: { code: r.reason } }, { status: 403 });
  return Response.json([]);
}
```

## Run the engine on your own database (`startLocal`)

`startLocal` lets a Node app keep its users in its **own Postgres** with no auth server to deploy. The SDK downloads the engine release it is tested with (`ENGINE_VERSION`, currently `v0.5.0`), checks its SHA-256 checksum, and starts it as a child process beside your app. The engine keeps its tables in its own schemas in your database. It listens only on a local address; your server passes the browser's `/aos/*` requests to it. The engine stops when your process exits.

**Fastest start:** `aosctl init shop --mode embedded --backend node --published` writes a working app (Express backend using `startLocal`, React frontend) and `aosctl dev` prepares its database. See the [aosctl README](https://github.com/flash-software-technology/aos-cli#embedded-mode-auth-inside-your-own-backend).

**1. Make a master key** (it encrypts the engine's signing keys; keep it out of git):

```sh
"$(node --input-type=module -e 'import { downloadEngine } from "@aos-auth/node"; console.log(await downloadEngine())')" keygen
```

Run it in your project folder after `npm install @aos-auth/node`. It downloads the engine (once, into the cache) and runs `aos keygen`. Put the output in `AOS_MASTER_KEY`.

**2. Start it in your server:**

```js
import express from "express";
import { startLocal, requireAuth } from "@aos-auth/node";

const local = await startLocal({
  databaseUrl: process.env.DATABASE_URL,          // your app's Postgres
  masterKey: process.env.AOS_MASTER_KEY,
  appUrl: "http://localhost:3000",                // your app's public address; email links point here
  development: true,                              // dev inbox instead of SMTP; drop in production
});

const app = express();
app.use(local.handler());        // /aos/* goes to the engine. Mount it BEFORE body parsers.
app.use(express.json());

const aos = local.aos;           // an ordinary Aos client, already holding the right keys
app.get("/api/me", requireAuth(aos), (req, res) => res.json({ userId: req.aos.userId }));

app.listen(3000, () => console.log("engine", local.version, "publishable key", local.publishableKey));
process.on("SIGTERM", async () => { await local.stop(); process.exit(0); });
```

**3. Point the browser at your own server:**

```tsx
<AosProvider url="http://localhost:3000/aos" publishableKey={publishableKeyFromServer} />
```

`local.publishableKey` is not secret; send it to the frontend however you like (an `/api/config` route, a template, an env var at build time). In development with `development: true`, emails are kept in a development inbox at `<appUrl>/aos/dev/mail` (from the same machine) when no SMTP server is set.

**Next.js:** in `app/aos/[...path]/route.ts`, pass requests through `local.fetch`, which takes a `Request`:

```ts
const handle = (request: Request) => local.fetch(request);
export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
```

### `startLocal(options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `databaseUrl` | required | Your Postgres. |
| `masterKey` | required | From `aos keygen`. Losing it means losing the engine's keys. |
| `appUrl` | required | Your app's address. Its origin is allowed to call `/aos`, and email links point there. |
| `path` | `"/aos"` | Where the browser routes are mounted. |
| `origins` | `[]` | More browser origins to allow, e.g. a Vite dev server `http://localhost:5173`. |
| `slug`, `name` | `"app"`, `"App"` | The application's tenant slug and display name. |
| `kind` | `"multi"` | `"multi"`: with organizations. `"single"`: without. |
| `development` | `false` | Keep email in a development inbox (when no SMTP is set); hand sessions to the browser in a header instead of a cookie. |
| `engine` | `$AOS_ENGINE`, else download | Path to an engine program you already have. |
| `engineVersion` | `ENGINE_VERSION` | Download a different release. |
| `env` | | Extra environment for the engine, e.g. `AOS_SMTP_ADDR`, `AOS_SMTP_USERNAME`, `AOS_SMTP_PASSWORD`, `AOS_MAIL_FROM`. |
| `log` | `"inherit"` | `"inherit"` prints the engine's log to your stderr; `"ignore"` hides it. |

It returns `{ aos, url, path, publishableKey, version, handler(), fetch(request), stop() }`:

| Member | Meaning |
| --- | --- |
| `aos` | An `Aos` client for your backend code (token checks, permissions, admin). |
| `url` | The engine's local address (`http://127.0.0.1:<port>`). Not for browsers. |
| `handler()` | Express/Connect middleware: forwards `<path>/*`, calls `next()` for everything else. |
| `fetch(request)` | The same for Fetch-API frameworks; answers 404 outside `<path>`. |
| `stop()` | Stops the engine (waits up to 5 s, then kills it). |

`downloadEngine(version?)` downloads a release on its own and returns the program's path. Downloads are cached in `$AOSCTL_CACHE_DIR` if set, else `$XDG_CACHE_HOME/aos` (default `~/.cache/aos`) on Linux, `~/Library/Caches/aos` on macOS, `%LocalAppData%\aos` on Windows: the same cache `aosctl` uses. `AOSCTL_RELEASES_URL` points downloads at a mirror. Builds exist for Linux, macOS and Windows on x64 and arm64.

## Reference

### `new Aos(options)`

| Option | Meaning |
| --- | --- |
| `url` | The engine's address. Required. |
| `publishableKey` | `pk_...`. Needed to verify tokens. |
| `secretKey` | `sk_...`. Needed for every backend call (`can`, `users`, …). |
| `keysTtlMs` | How long fetched public keys are trusted. Default 10 minutes. |
| `fetch` | Your own fetch. |

### Methods

| Area | API |
| --- | --- |
| Tokens | `verifyToken(token)` → `Claims` (throws `InvalidTokenError`) |
| Permissions | `can(req)`, `canBatch(reqs)`, `filter(principalId, permission, resourceType)`, `explain(req)` |
| Model | `permissions.put/list`, `roles.put/list`, `resources.put(resource, parent?, displayName?)`, `grants.create/delete` |
| Users | `users.create/get/list/suspend/reinstate/delete` |
| Organizations | `organizations.create(name, slug, owner?)/list/members(id)/invite(id, email, role)` |
| Machines | `apiKeys.create(principalId, name, scopes?)`, `apiKeys.check(key, permission?, resource?)` |
| Webhooks | `webhooks.create(url, eventTypes?)` |
| Low level | `request(method, path, body?)`: any backend route, with the secret key |

### Helpers

| Export | What it does |
| --- | --- |
| `requireAuth(aos, { optional? })` | Express: verifies the bearer token, sets `req.aos`. 401 `unauthenticated` without one (or continues, with `optional: true`); 503 `auth_unavailable` if keys cannot be fetched. |
| `requirePermission(aos, permission, resourceFn?)` | Express, after `requireAuth`: 403 with the reason as `code` when denied; 503 `permission_check_failed` if the engine cannot answer. `resourceFn` defaults to `activeOrganization`. |
| `activeOrganization(req)` | `{ type: "organization", id }` for the token's active organization, else the root. |
| `root()` | `{ type: "tenant", id: "root" }`. |
| `canMiddleware(aos)` / `canHandler(aos)` | The `<Protect>` endpoint for Express / Fetch API. Body `{ permissions, resource? }` (max 100 permissions) → `{ results }`. Needs a JSON body parser in Express. |
| `getAuth(aos, request)` | Fetch API: the claims, or `null`. |
| `tokenFromHeaders(headers)` | The bearer token from Node or Fetch headers, or `""`. |
| `verifyWebhook(secret, header, rawBody, toleranceSeconds?)`, `signWebhook(secret, rawBody)` | Webhook signatures (`X-AOS-Signature: t=...,v1=...`). |
| `startLocal`, `downloadEngine`, `ENGINE_VERSION` | Own-database mode, above. |
| `VERSION` | This SDK's version. |

Errors: `AosError` (`status`, `code`, `message`, `details`) for engine errors; `InvalidTokenError`; `BadSignatureError`.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `aos: verifying tokens needs the publishableKey option` | Pass `publishableKey` to `new Aos`. |
| `aos: backend calls need the secretKey option` / `secretKey must be a secret key (sk_...)` | Pass the `sk_...` key (not the `pk_...` one). |
| Every request is 401 | The browser sent no token (use `aos.fetch` / `useAos().fetch`), or the backend points at a different engine or tenant than the browser. |
| 403 with `code: "no_matching_grant"` | Signed in but no role grants the permission on that resource. Grant one: `aosctl grant --user you@example.com --role Viewer`, or `aos.grants.create(...)`. |
| 403 `step_up_required` | The permission needs a recent second factor: the browser calls `stepUp(code)` and retries. |
| 503 `auth_unavailable` | The engine's public keys could not be fetched: check `AOS_URL` and that the engine is running. |
| `BadSignatureError` on every webhook | A JSON parser read the body first. Use `express.raw()` on that route, before `express.json()`. |
| `aos: databaseUrl, masterKey and appUrl are required` | One of the three `startLocal` options is empty (often an env variable not loaded). |
| `AOS_MASTER_KEY is not set (make one with: aos keygen)` | See step 1 above. |
| `aos: the engine stopped while starting` | Read the engine log printed just before (bad database URL, database unreachable, wrong master key for existing data). |
| `aos: download ...: 404` / no build for your platform | No network, or an unsupported OS/CPU. Download the engine yourself and set `AOS_ENGINE` (or `engine`). |
| Requests to `/aos/*` hang | `local.handler()` was mounted after a body parser. Mount it first. |

## Developing this package

Lives in `packages/node` of [aos-js](https://github.com/flash-software-technology/aos-js). From the repo root: `npm install`, then `npm test` (builds and runs `packages/node/test/node.test.mjs`, no engine needed). `npm run test:integration` needs a running engine; the `startLocal` test needs `AOS_IT_ENGINE`, `AOS_IT_DATABASE_URL` (a throwaway database) and `AOS_IT_MASTER_KEY`.

## Licence

Apache-2.0.
