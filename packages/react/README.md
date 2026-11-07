# @aos-auth/react

React components and hooks for AOS: ready-made sign-in and sign-up screens, the pages email links open, a user menu, an organization switcher, and `<Protect>` for showing what a person may use.

```sh
npm install @aos-auth/react
```

```tsx
import { AosProvider, AuthRoutes, SignedIn, SignedOut, UserButton, OrganizationSwitcher, Protect, useAos } from "@aos-auth/react";
import "@aos-auth/react/styles.css";

export function App({ path }: { path: string }) {
  return (
    <AosProvider url={import.meta.env.VITE_AOS_URL} publishableKey={import.meta.env.VITE_AOS_PUBLISHABLE_KEY} canEndpoint="/api/aos/can">
      {path.startsWith("/auth/") ? <AuthRoutes pathname={path} /> : <Home />}
    </AosProvider>
  );
}

function Home() {
  return (
    <>
      <SignedIn><OrganizationSwitcher /><UserButton /></SignedIn>
      <SignedOut><a href="/auth/sign-in">Sign in</a></SignedOut>
      <Protect permission="invoice.read" fallback={<p>No access.</p>}><Invoices /></Protect>
    </>
  );
}
```

| Piece | What it does |
| --- | --- |
| `AuthRoutes` | Every page the engine's emails link to: `/auth/sign-in`, `sign-up`, `verify-email`, `forgot-password`, `reset-password`, `setup`, `invitation`, `magic-link`, `confirm-email`, `sso/callback`. Mount it on `/auth/*`. |
| `SignIn`, `SignUp`, `AcceptInvitation`, … | Each page on its own. `<SignIn socialProviders={["google"]} sso />` |
| `SignedIn`, `SignedOut`, `UserButton`, `OrganizationSwitcher` | Follow the session |
| `Protect` | Hides what the person may not use, by asking your backend's `canEndpoint`. It is not security: the backend checks again. |
| `useUser`, `useSession`, `useOrganization`, `usePermission`, `useAos` | The same data in your own components; `useAos().fetch()` calls your backend with the session token |

The look comes from CSS variables (`--aos-accent`, `--aos-radius`, …) in `styles.css`, with a dark variant.

Source and issues: https://github.com/flash-softeware/aos-js
