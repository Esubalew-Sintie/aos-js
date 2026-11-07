# @aos-auth/js

The AOS client for browsers and React Native: sign-up, sign-in (password, email code, magic link, passkey, Google and other OpenID providers, company SSO), second factors, sessions, organizations, invitations and account settings. Using React? Start with [`@aos-auth/react`](https://www.npmjs.com/package/@aos-auth/react), which includes this.

```sh
npm install @aos-auth/js
```

```ts
import { createClient, isAosError } from "@aos-auth/js";

const aos = createClient({ url: "https://auth.example.com", publishableKey: "pk_live_..." });

const r = await aos.signIn({ email, password });
if (r.status === "second_factor") await aos.secondFactor({ method: "totp", code });

const res = await aos.fetch("/api/invoices");   // your backend, with "Authorization: Bearer <token>"
```

- `aos.fetch` attaches a signed token valid for 60 seconds, reused until 10 seconds before it expires. Your backend checks it with `@aos-auth/node`, `aos-go` or `aos-auth` (Python).
- Errors are `AosError` with a stable `code` (`invalid_credentials`, `rate_limited`, `invalid_token`, …) and a message written for people. `isAosError(e, "rate_limited")` tests for one.
- `aos.onChange(fn)` is called when the person signs in, signs out or switches organization.

## React Native

Use token sessions and give the client secure storage:

```ts
import * as SecureStore from "expo-secure-store";

const aos = createClient({
  url, publishableKey, sessionKind: "token",
  storage: { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync },
});
```

The client keeps an access and a refresh token, renews on a 401, and signs the person out when renewal fails.

Source and issues: https://github.com/flash-softeware/aos-js
