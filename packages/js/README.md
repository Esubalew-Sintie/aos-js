# @aos-auth/js

The AOS client for browsers and React Native. It signs people up and in (password, email code, magic link, passkey, Google and other social providers, company SSO), handles second factors, sessions, organizations and invitations, and gives your backend a signed token to check.

> Part of **AOS**, an identity and access platform. Source: [aos-js](https://github.com/flash-software-technology/aos-js).
> Using React? Install [`@aos-auth/react`](https://www.npmjs.com/package/@aos-auth/react) instead. It includes this package and ready-made screens.

## Where it fits

| Piece | Job |
| --- | --- |
| **`@aos-auth/js`** (this) | Runs in the browser or app. Talks to the AOS engine with the publishable key. |
| [`@aos-auth/react`](https://www.npmjs.com/package/@aos-auth/react) | React components and hooks on top of this package. |
| [`@aos-auth/node`](https://www.npmjs.com/package/@aos-auth/node), [aos-go](https://github.com/flash-software-technology/aos-go), [aos-python](https://github.com/flash-software-technology/aos-python) | Your backend: checks the token this package sends, and checks permissions. |
| [aos](https://github.com/flash-software-technology/aos) engine, [aosctl](https://github.com/flash-software-technology/aos-cli) | The server, and the CLI that runs it locally (`aosctl dev`). |

## Install

```sh
npm install @aos-auth/js
```

It is an ES module with TypeScript types and no dependencies.

You need a running engine and a publishable key. For development, run `aosctl dev` (from [aos-cli](https://github.com/flash-software-technology/aos-cli)); it writes `AOS_URL` and `AOS_PUBLISHABLE_KEY` (plus `VITE_` and `NEXT_PUBLIC_` copies) to `.env`.

## Quick start

```ts
import { createClient, isAosError } from "@aos-auth/js";

const aos = createClient({
  url: "http://127.0.0.1:8080",        // the engine (from .env: AOS_URL)
  publishableKey: "pk_test_...",       // safe in browser code
});

// 1. Sign in
const r = await aos.signIn({ email: "ana@example.com", password: "..." });
if (r.status === "second_factor") {
  // The account has two-step verification: ask for the 6-digit code.
  await aos.secondFactor({ method: "totp", code: "123456" });
}

// 2. Who is signed in?
const s = await aos.getSession();      // { user, session } or null
console.log(s?.user.email);

// 3. Call your own backend with a token it can check
const res = await aos.fetch("/api/invoices");   // adds "Authorization: Bearer <token>"
```

Errors are thrown as `AosError`:

```ts
try {
  await aos.signIn({ email, password });
} catch (e) {
  if (isAosError(e, "invalid_credentials")) showError("Wrong email or password.");
  else if (isAosError(e, "rate_limited")) showError(`Try again in ${e.details.retry_after} seconds.`);
  else throw e;
}
```

## Common tasks

### Sign up and confirm the email

```ts
await aos.signUp({ email, password, name: "Ana" });   // always { status: "check_email" }
// The email links to <your app>/auth/verify-email?token=...  On that page:
const token = new URLSearchParams(location.search).get("token")!;
await aos.verifyEmail(token);                          // signs the person in
```

`signUp` answers the same way whether or not the address already has an account, so it cannot be used to find out who has signed up.

### Every sign-in result

`signIn`, `secondFactor`, `verifyCode`, `magicLink`, `verifyEmail`, `setupAccount`, `signInAsGuest`, `finishSocial`, `finishSSO`, `signInWithPasskey` and `signUpWithInvitation` all return a `SignInResult`:

```ts
type SignInResult =
  | { status: "signed_in"; user: User; session: SessionInfo; secondFactorSetupRequired: boolean }
  | { status: "second_factor"; methods: string[] };   // e.g. ["totp", "recovery_code", "passkey"]
```

### Second factor (MFA) during sign-in

```ts
if (r.status === "second_factor") {
  await aos.secondFactor({ method: "totp", code });            // authenticator app
  // or { method: "recovery_code", code }  or  { method: "passkey" }
}
```

The client remembers the pending sign-in. If it is gone or too old you get `signin_expired`: start again.

### Email code and magic link (no password)

```ts
await aos.sendCode(email);                     // emails a 6-digit code and a link
await aos.verifyCode(email, "123456");         // the code typed in
await aos.magicLink(tokenFromTheLink);         // or: the token from the link
```

### Guests

```ts
await aos.signInAsGuest("Visitor");            // act before signing up
await aos.upgradeGuest({ email, password });   // later: a confirmation email follows
```

### Social sign-in (Google, Microsoft, GitHub, ...) and company SSO

Both are redirects. The provider must be set up for your tenant.

```ts
// Start: send the browser to the provider.
location.assign(await aos.startSocial("google", location.origin + "/auth/sign-in"));
// Company SSO, chosen by the work email's domain:
location.assign(await aos.startSSO("ana@acme.com", location.origin + "/auth/sso/callback"));

// Back on the redirect page, the address has ?state=...&code=...
const q = new URLSearchParams(location.search);
await aos.finishSocial("google", { state: q.get("state")!, code: q.get("code")! });
// or: await aos.finishSSO({ state, code })
```

### Passkeys

```ts
await aos.signInWithPasskey();              // no email typed
await aos.addPasskey("MacBook");            // signed in: register one
await aos.listPasskeys();
await aos.removePasskey(id);
```

Throws `AosError` with code `passkeys_unsupported` where there is no WebAuthn, or `passkey_cancelled` when the person closes the prompt.

### Authenticator app (TOTP) and recovery codes

```ts
const { secret, uri } = await aos.enrollTotp();   // show uri as a QR code
const codes = await aos.confirmTotp("123456");    // recovery codes: show once
await aos.factors();                              // { totp, passkeys, recovery_codes_left, required, ... }
await aos.regenerateRecoveryCodes("123456");
await aos.disableTotp("123456");
await aos.stepUp("123456");   // refresh the second factor for a permission that needs a recent one
```

### Passwords and email address

```ts
await aos.forgotPassword(email);                 // emails a reset link
await aos.resetPassword(token, newPassword);     // on the reset page
await aos.changePassword(current, next);
await aos.changeEmail(newEmail, password);       // a confirmation goes to the new address
await aos.confirmEmail(token);                   // on the confirm page
await aos.setupAccount(token, password);         // finish an account an admin created
```

### Tokens for your backend

```ts
const token = await aos.getToken();   // string, or null when signed out
await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
// or simply:
await aos.fetch("/api/me", { method: "GET" });
```

The token is a signed JWT valid for 60 seconds. The client reuses it until 10 seconds before it expires. It carries the active organization, so switch organizations before calling your backend about one. Your backend checks it with `@aos-auth/node` (`verifyToken`, `requireAuth`), aos-go or aos-python.

### Sessions and signing out

```ts
aos.onChange((s) => render(s));     // sign-in, sign-out, organization switch; returns an unsubscribe function
await aos.getSession(true);         // force a fresh answer from the engine
await aos.listSessions();           // this person's devices
await aos.endSession(id);
await aos.signOut();
await aos.signOutEverywhere();
```

### Organizations and invitations

```ts
const org = await aos.createOrganization("Acme", "acme");   // slug is optional
await aos.listOrganizations();
await aos.switchOrganization(org.id);    // the backend token now carries this organization
await aos.listMembers(org.id);
await aos.changeMemberRole(org.id, principalId, "Billing");
await aos.removeMember(org.id, principalId);

await aos.invite(org.id, "sam@example.com", "Viewer");
await aos.listInvitations(org.id);
// On the invitation page (?token=...):
const p = await aos.previewInvitation(token);   // { organization_name, email, role, account_exists, ... }
await aos.acceptInvitation(token);              // signed in already
await aos.signUpWithInvitation(token, password, "Sam");   // new account and join
await aos.declineInvitation(token);
```

### Account

```ts
await aos.exportAccount(password);   // the person's data
await aos.deleteAccount(password);   // and signs out
```

### React Native and other non-browser apps

Use token sessions and a secure store:

```ts
import * as SecureStore from "expo-secure-store";

const aos = createClient({
  url, publishableKey,
  sessionKind: "token",
  storage: { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync },
});
```

The client keeps an access token and a refresh token, renews on a 401, and signs the person out if renewal fails.

## Reference

### `createClient(options)` / `new AosClient(options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | required | The engine's address, e.g. `https://auth.example.com` or `http://127.0.0.1:8080`. With `startLocal` it is your app's address plus `/aos`. |
| `publishableKey` | required | `pk_...`. A secret key here throws. |
| `sessionKind` | `"browser"` | `"browser"`: in production the session is a cookie locked to the engine's host; a development tenant hands it back and it travels in the `X-AOS-Session` header. `"token"`: access and refresh tokens, for mobile apps. |
| `storage` | `localStorage`, else memory | Where development and token sessions are kept: `{ getItem, setItem, removeItem }`, sync or async. |
| `fetch` | global `fetch` | Your own fetch, for tests or special runtimes. |

### Methods

| Area | Methods |
| --- | --- |
| Session | `getSession(force?)`, `onChange(fn)`, `getToken()`, `fetch(input, init?)`, `signOut()`, `signOutEverywhere()`, `listSessions()`, `endSession(id)` |
| Sign-up / sign-in | `signUp`, `verifyEmail`, `signIn`, `secondFactor`, `sendCode`, `verifyCode`, `magicLink`, `setupAccount`, `signInAsGuest`, `upgradeGuest` |
| Redirect sign-in | `startSocial(provider, redirectUri)`, `finishSocial(provider, {state, code})`, `startSSO(email, redirectUri)`, `finishSSO({state, code})` |
| Passwords / email | `forgotPassword`, `resetPassword`, `changePassword`, `changeEmail`, `confirmEmail` |
| Second factors | `factors`, `enrollTotp`, `confirmTotp`, `disableTotp`, `regenerateRecoveryCodes`, `stepUp(code, method?)` |
| Passkeys | `signInWithPasskey`, `addPasskey(name?)`, `listPasskeys`, `removePasskey(id)` |
| Organizations | `listOrganizations`, `createOrganization(name, slug?)`, `switchOrganization(id)`, `listMembers`, `changeMemberRole`, `removeMember` |
| Invitations | `invite(orgId, email, role)`, `listInvitations`, `previewInvitation`, `acceptInvitation`, `declineInvitation`, `signUpWithInvitation` |
| Account | `exportAccount(password)`, `deleteAccount(password)` |
| Low level | `request(method, path, body?)`: any engine route; returns the answer's `data` |

### Other exports

- `AosError`: `status`, `code` (stable, e.g. `invalid_credentials`, `wrong_code`, `signin_expired`, `rate_limited`, `sso_required`), `message` (written for people), `type`, `details`.
- `isAosError(e, code?)`: type guard.
- `toBase64url`, `fromBase64url`.
- Types: `User`, `Session`, `SessionInfo`, `SignInResult`, `Organization`, `Member`, `Invitation`, `InvitationPreview`, `Factors`, `Passkey`, `DeviceSession`, `TokenStorage`, `ClientOptions`.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `aos: publishableKey must be a publishable key (pk_...)` | You passed the secret key, or an empty value. Use `pk_...`. Never put `sk_...` in frontend code. |
| `aos: url is required` | The env variable is missing. In Vite use `VITE_AOS_URL`; in Next.js `NEXT_PUBLIC_AOS_URL`. Restart the dev server after `aosctl dev` writes `.env`. |
| Browser console shows a CORS error | The page's origin is not allowed by the tenant. `aosctl dev` allows its `--app-url` (default `http://localhost:5173`); with `startLocal`, the `appUrl` origin is allowed and you add dev servers with `origins`. |
| Signed in, but `getSession()` is `null` after a reload in production | Production browser sessions are a cookie set by the engine's host. If the engine is on a different site from your app, the browser may treat it as a third-party cookie and drop it. Serve the engine on your app's own site (`startLocal` in `@aos-auth/node` mounts it at `/aos`). |
| `getToken()` returns `null` | Nobody is signed in, or the session ended. |
| Your backend answers 401 | No token or a bad one: call it with `aos.fetch(...)`, and check the backend uses the same engine URL and publishable key. 403 means signed in but missing the permission. |
| No email arrives in development | It is kept in the development inbox: run `aosctl mail`. |
| `signin_expired` from `secondFactor` | The pending sign-in was lost or is too old. Sign in again. |

## Developing this package

Lives in `packages/js` of [aos-js](https://github.com/flash-software-technology/aos-js). From the repo root: `npm install`, then `npm test` (builds and runs `packages/js/test/client.test.mjs`, no engine needed).

## Licence

Apache-2.0.
