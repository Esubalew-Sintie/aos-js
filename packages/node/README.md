# @aos-auth/node

AOS for Node backends: check session tokens, ask about permissions, guard routes, manage users, roles, organizations, API keys and webhooks. Helpers for Express and for frameworks built on `Request`/`Response` (Next.js route handlers, Hono, Remix).

```sh
npm install @aos-auth/node
```

```js
import express from "express";
import { Aos, requireAuth, requirePermission, canMiddleware, activeOrganization } from "@aos-auth/node";

const aos = new Aos({
  url: process.env.AOS_URL,
  publishableKey: process.env.AOS_PUBLISHABLE_KEY,   // to check tokens
  secretKey: process.env.AOS_SECRET_KEY,             // for backend calls; never in a browser
});

const app = express();
app.use(express.json());
app.get("/api/me", requireAuth(aos), (req, res) => res.json({ user: req.aos.userId }));
app.get("/api/invoices", requireAuth(aos), requirePermission(aos, "invoice.read", activeOrganization), listInvoices);
app.post("/api/aos/can", canMiddleware(aos));        // answers <Protect> in @aos-auth/react
```

Next.js route handler:

```ts
import { canHandler, getAuth } from "@aos-auth/node";
export const POST = canHandler(aos);                 // app/api/aos/can/route.ts
const claims = await getAuth(aos, request);          // null when not signed in
```

- `aos.verifyToken(token)` checks a token locally against the engine's public keys (fetched once, cached) and returns the claims: `userId`, `sessionId`, `organization`.
- `aos.can({...})`, `canBatch`, `filter`, `explain`; `aos.permissions`, `aos.roles`, `aos.resources`, `aos.grants`, `aos.users`, `aos.organizations`, `aos.apiKeys`, `aos.webhooks`.
- `verifyWebhook(secret, signatureHeader, rawBody)` checks a delivery; read the raw body before any JSON parser.

Source and issues: https://github.com/flash-softeware/aos-js
