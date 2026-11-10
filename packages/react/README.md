# @aos-auth/react

React components and hooks for AOS: ready-made sign-in and sign-up screens, the pages that email links open, a user menu, an organization switcher, and `<Protect>` to show only what a person may use.

> Part of **AOS**, an identity and access platform. Source: [aos-js](https://github.com/flash-software-technology/aos-js).

## Where it fits

| Piece | Job |
| --- | --- |
| **`@aos-auth/react`** (this) | Your React frontend (Vite, Next.js, …). Includes and re-exports [`@aos-auth/js`](https://www.npmjs.com/package/@aos-auth/js). |
| [`@aos-auth/node`](https://www.npmjs.com/package/@aos-auth/node), [aos-go](https://github.com/flash-software-technology/aos-go), [aos-python](https://github.com/flash-software-technology/aos-python) | Your backend: checks the session token and answers `<Protect>`'s permission questions. |
| [aos](https://github.com/flash-software-technology/aos) engine, [aosctl](https://github.com/flash-software-technology/aos-cli) | The server, and the CLI that runs it locally (`aosctl dev`). |

## Install

```sh
npm install @aos-auth/react
```

Needs React 18 or newer. You also need a running engine and its publishable key. For development, `aosctl dev` (from [aos-cli](https://github.com/flash-software-technology/aos-cli)) starts one and writes `VITE_AOS_URL`, `VITE_AOS_PUBLISHABLE_KEY`, `NEXT_PUBLIC_AOS_URL` and `NEXT_PUBLIC_AOS_PUBLISHABLE_KEY` to `.env`.

Want a working project in one go? `aosctl init my-app --frontend react-vite --backend node --published` makes one with everything below already wired.

## Quick start (Vite)

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import "@aos-auth/react/styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

```tsx
// src/App.tsx
import { AosProvider, AuthRoutes, SignedIn, SignedOut, UserButton, OrganizationSwitcher, Protect } from "@aos-auth/react";

export function App() {
  const path = window.location.pathname;
  return (
    <AosProvider
      url={import.meta.env.VITE_AOS_URL}
      publishableKey={import.meta.env.VITE_AOS_PUBLISHABLE_KEY}
      canEndpoint="/api/aos/can"
    >
      {path.startsWith("/auth/") ? <AuthRoutes /> : <Home />}
    </AosProvider>
  );
}

function Home() {
  return (
    <>
      <SignedIn><OrganizationSwitcher /> <UserButton /></SignedIn>
      <SignedOut><a href="/auth/sign-in">Sign in</a></SignedOut>
      <Protect permission="invoice.read" fallback={<p>No access.</p>}>
        <Invoices />
      </Protect>
    </>
  );
}
```

Point Vite's `/api` at your backend so the browser calls one origin:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  envDir: "..",                                           // if .env is one folder up
  server: { proxy: { "/api": "http://127.0.0.1:4000" } },
});
```

Open `/auth/sign-up`, create an account, open the confirmation link (`aosctl mail` shows the development inbox), and you are signed in.

## Quick start (Next.js App Router)

The components use hooks, so put them in a client component.

```tsx
// app/providers.tsx
"use client";
import { useRouter } from "next/navigation";
import { AosProvider } from "@aos-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <AosProvider
      url={process.env.NEXT_PUBLIC_AOS_URL!}
      publishableKey={process.env.NEXT_PUBLIC_AOS_PUBLISHABLE_KEY!}
      navigate={(to) => router.push(to)}
      canEndpoint="/api/aos/can"
    >
      {children}
    </AosProvider>
  );
}
```

```tsx
// app/layout.tsx
import "@aos-auth/react/styles.css";
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
```

```tsx
// app/auth/[...page]/page.tsx: every /auth page
"use client";
import { usePathname } from "next/navigation";
import { AuthRoutes } from "@aos-auth/react";

export default function AuthPage() {
  return <AuthRoutes pathname={usePathname()} />;
}
```

```ts
// app/api/aos/can/route.ts: answers <Protect> (needs @aos-auth/node)
import { Aos, canHandler } from "@aos-auth/node";

const aos = new Aos({ url: process.env.AOS_URL!, publishableKey: process.env.AOS_PUBLISHABLE_KEY, secretKey: process.env.AOS_SECRET_KEY });
export const POST = canHandler(aos);
```

## How `<Protect>` works

`<Protect permission="invoice.read">` does not decide anything in the browser. It asks your backend:

1. The provider sends `POST <canEndpoint>` (default `/api/aos/can`) with `Authorization: Bearer <session token>` and body `{"permissions": ["invoice.read"], "resource": {"type": "invoice", "id": "42"}}` (resource optional).
2. Your backend verifies the token and asks the engine. `canHandler` (Next.js, Fetch API) and `canMiddleware` (Express) from `@aos-auth/node` do this for you. Without a resource they ask about the person's **active organization**, or the tenant root when there is none.
3. The backend answers `{"results": {"invoice.read": true}}`. Any non-2xx answer counts as "not allowed".

While the answer is loading, `<Protect>` renders nothing. Signed-out visitors are never allowed.

**`<Protect>` only hides UI. It is not security.** Your backend must check the permission again on the real route (for example `requirePermission` in `@aos-auth/node`).

To answer permission questions some other way, pass `can={async (permissions, resource) => ({ ... })}` to `AosProvider`.

## Common tasks

### Use the session in your own components

```tsx
import { useUser, useSession, useOrganization, usePermission, useAos } from "@aos-auth/react";

function Header() {
  const { loaded, isSignedIn, user } = useUser();
  if (!loaded) return null;
  return isSignedIn ? <span>Hi {user!.name ?? user!.email}</span> : <a href="/auth/sign-in">Sign in</a>;
}

function RefundButton({ invoiceId }: { invoiceId: string }) {
  const { allowed } = usePermission("invoice.refund", { type: "invoice", id: invoiceId });
  return allowed ? <button>Refund</button> : null;
}
```

### Call your backend with the session token

```tsx
const aos = useAos();                                   // the @aos-auth/js client
const res = await aos.fetch("/api/invoices");           // adds Authorization: Bearer <token>
```

Everything from `@aos-auth/js` is re-exported, and `useAos()` returns its client, so passkeys, TOTP, sessions and the rest are available too (see the [`@aos-auth/js` README](https://www.npmjs.com/package/@aos-auth/js)).

### Organizations

```tsx
const { organizations, active, switchTo, create, reload, loaded } = useOrganization();
```

Or drop in `<OrganizationSwitcher />`: it lists the person's organizations, switches the active one and can create new ones (`allowCreate={false}` to hide that).

### Require sign-in for a page

```tsx
<SignedOut><RedirectToSignIn /></SignedOut>
<SignedIn><Dashboard /></SignedIn>
```

`RedirectToSignIn` sends the visitor to `/auth/sign-in?redirect_url=<this page>`, and they come back after signing in.

### Social sign-in, company SSO, passkeys, email codes

```tsx
<AuthRoutes signIn={{ socialProviders: ["google", "microsoft"], sso: true }} />
// or a single screen:
<SignIn socialProviders={["google"]} sso passkeys emailCode redirectUrl="/dashboard" />
```

The providers must be set up for your tenant. The redirect comes back to the sign-in page, which finishes it.

### Theme

The look comes from CSS variables in `styles.css`, with a dark variant for `prefers-color-scheme: dark`. Override them in your own CSS:

```css
:root { --aos-accent: #0f766e; --aos-radius: 12px; }
```

Variables: `--aos-accent`, `--aos-accent-text`, `--aos-bg`, `--aos-surface`, `--aos-text`, `--aos-muted`, `--aos-border`, `--aos-danger`, `--aos-radius`, `--aos-font`.

## Reference

### `<AosProvider>` props

| Prop | Default | Meaning |
| --- | --- | --- |
| `url` | required (unless `client`) | The engine's address. |
| `publishableKey` | required (unless `client`) | `pk_...`. |
| `sessionKind`, `storage`, `fetch` | | Passed to `createClient` (see `@aos-auth/js`). |
| `client` | | An existing `AosClient` instead of `url`/`publishableKey`. |
| `canEndpoint` | `"/api/aos/can"` | Your backend route that answers permission questions. |
| `can` | | Your own `(permissions, resource?) => Promise<Record<string, boolean>>`. |
| `navigate` | full page load | Your router's navigate, e.g. `(to) => router.push(to)`. |
| `paths` | `{ signIn: "/auth/sign-in", signUp: "/auth/sign-up", forgotPassword: "/auth/forgot-password" }` | Where the screens link to each other. |
| `afterSignInUrl` / `afterSignOutUrl` | `"/"` | Where to go after signing in / out. |
| `initialSession` | | For server rendering: the session already known, or `null`. |

### Components

| Component | What it does |
| --- | --- |
| `AuthRoutes` | All `/auth` pages in one component. Props: `pathname?` (else reads `window.location`), `base?` (`"/auth"`), `signIn?` (`SignInProps`), `notFound?`. Honours `?redirect_url=` (same-site paths only). |
| `SignIn` | Password, email code, passkey, social and SSO sign-in, plus the second-factor step. Props: `socialProviders?`, `sso?`, `passkeys?` (default on when supported), `emailCode?` (default true), `redirectUrl?`. |
| `SignUp` | Name, email, password; then "check your email". |
| `VerifyEmail`, `MagicLink`, `ConfirmEmail` | Read `?token=` and finish the action. |
| `ForgotPassword`, `ResetPassword` | Request a reset link; choose a new password. |
| `AccountSetup` | Finish an account an admin created (choose a password). |
| `AcceptInvitation` | Shows the invitation; accept/decline, sign in, or create an account and join. |
| `SignedIn`, `SignedOut` | Render children only when signed in / signed out (neither while loading). |
| `Protect` | `permission`, `resource?`, `fallback?`: see above. |
| `RedirectToSignIn` | Sends a signed-out visitor to the sign-in page. |
| `UserButton` | Avatar with a menu: name, email, your `children`, Sign out. |
| `OrganizationSwitcher` | `allowCreate?` (default true), `personalLabel?`. |

The `/auth` paths `AuthRoutes` serves (the engine's emails link to them): `sign-in`, `sign-up`, `verify-email`, `forgot-password`, `reset-password`, `setup`, `invitation`, `magic-link`, `confirm-email`, `sso/callback`.

### Hooks and helpers

| Export | Returns |
| --- | --- |
| `useUser()` | `{ loaded, isSignedIn, user }` |
| `useSession()` | `{ loaded, session }` |
| `useOrganization()` | `{ loaded, organizations, active, switchTo(id), create(name), reload() }` |
| `usePermission(permission, resource?)` | `{ loaded, allowed }` |
| `useAos()` | the `AosClient` |
| `useAosContext()` | everything the provider holds (`client`, `session`, `can`, `navigate`, `paths`, …) |
| `routeFor(pathname, base?)` | which `/auth` page a path is, or `null` |
| `safeRedirect(value, fallback)` | `value` if it is a same-site path, else `fallback` |
| `messageOf(error)` | a sentence to show for an error |

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `aos: wrap your app in <AosProvider>` | A hook or component is outside the provider. |
| `aos: publishableKey must be a publishable key (pk_...)` | The env variable is missing or holds the secret key. Vite needs the `VITE_` prefix, Next.js `NEXT_PUBLIC_`. Restart the dev server after editing `.env`. |
| Next.js: "useState only works in Client Components" | Import the components from a file that starts with `"use client"`. |
| `<Protect>` never shows its children | Check the network tab: `POST /api/aos/can` must reach your backend (Vite proxy, Next route) and answer `{"results": {...}}`. 401 = token not verified (backend uses a different engine URL or publishable key); `false` = the person lacks the permission on the active organization (grant it, e.g. `aosctl grant --user you@example.com --role Viewer`). |
| Screens look unstyled | Import `@aos-auth/react/styles.css` once. |
| No verification email | In development it is in the inbox: `aosctl mail`. |
| CORS error calling the engine | The page's origin is not allowed by the tenant (see `aosctl dev --app-url`, or `origins` in `startLocal`). |

## Developing this package

Lives in `packages/react` of [aos-js](https://github.com/flash-software-technology/aos-js) and depends on `packages/js` at the same version. From the repo root: `npm install`, then `npm test` (builds and runs `packages/react/test/react.test.mjs`).

## Licence

Apache-2.0.
