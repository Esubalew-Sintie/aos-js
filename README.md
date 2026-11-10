# aos-js

The JavaScript and TypeScript SDKs for AOS. This repo has three npm packages: one for the browser, one for React, and one for Node servers.

> Part of **AOS**, an identity and access platform: sign-up and sign-in, sessions, MFA, passkeys, social and company SSO, organizations, roles and permissions, webhooks. The engine lives in [aos](https://github.com/flash-software-technology/aos).

## Which package do I need?

| Package | Use it when | Install | Version |
| --- | --- | --- | --- |
| [`@aos-auth/react`](packages/react) | Your frontend is React (Vite, Next.js, …). It gives you ready-made sign-in and sign-up screens, hooks and `<Protect>`. It includes `@aos-auth/js`. | `npm i @aos-auth/react` | 0.3.0 |
| [`@aos-auth/js`](packages/js) | Your frontend is not React (plain JS, Vue, Svelte, React Native), or you want to build your own screens. | `npm i @aos-auth/js` | 0.3.0 |
| [`@aos-auth/node`](packages/node) | Your backend is Node. It checks session tokens, checks permissions, manages users and roles, verifies webhooks, and can run the engine on your own database (`startLocal`). | `npm i @aos-auth/node` | 0.4.0 |

A typical app uses two: `@aos-auth/react` in the browser and `@aos-auth/node` on the server.

How the pieces talk:

1. The **browser** talks to the AOS engine directly with the **publishable key** (`pk_...`). It is safe to ship in frontend code.
2. When the browser calls **your backend**, it sends a short-lived signed token (`Authorization: Bearer ...`).
3. Your **backend** checks that token against the engine's public keys, and asks the engine about permissions with the **secret key** (`sk_...`). The secret key never goes to the browser.

### The rest of the AOS family

| Piece | Install |
| --- | --- |
| Engine (server) | [aos](https://github.com/flash-software-technology/aos) v0.5.0: release download, `go get github.com/flash-software-technology/aos@v0.5.0`, or `ghcr.io/flash-software-technology/aos` |
| CLI `aosctl` | `go install github.com/flash-software-technology/aos-cli/cmd/aosctl@latest` ([aos-cli](https://github.com/flash-software-technology/aos-cli)) |
| Go SDK | `go get github.com/flash-software-technology/aos-go` ([aos-go](https://github.com/flash-software-technology/aos-go)) |
| Python SDK | `pip install "aos-auth @ git+https://github.com/flash-software-technology/aos-python@v0.4.0"` (PyPI package coming) |

A hosted AOS service is coming; it is not public yet.

## Five-minute start

The fastest way to see everything working is to let `aosctl` make a project for you. You need Go 1.24+ (for `aosctl`), Docker and Node 22.9+.

```sh
go install github.com/flash-software-technology/aos-cli/cmd/aosctl@latest
aosctl init my-app --frontend react-vite --backend node --published
cd my-app
aosctl dev                      # terminal 1: Postgres + engine, writes keys to .env
aosctl seed                     # sample permissions, roles (Viewer, Billing), user ana@example.com
cd api && npm install && npm run dev    # terminal 2: backend on http://localhost:4000
cd web && npm install && npm run dev    # terminal 3: open http://localhost:5173
aosctl mail                     # dev inbox: verification and setup links land here
aosctl grant --user you@example.com --role Viewer
```

Sign up in the browser, open the confirmation link with `aosctl mail`, then grant yourself a role and watch `<Protect>` show the invoices page.

`aosctl dev` writes these variables to `.env`; the SDK examples in this repo read the same names:

| Variable | Used by |
| --- | --- |
| `AOS_URL`, `AOS_PUBLISHABLE_KEY`, `AOS_SECRET_KEY` | your Node backend (`@aos-auth/node`) |
| `VITE_AOS_URL`, `VITE_AOS_PUBLISHABLE_KEY` | a Vite frontend |
| `NEXT_PUBLIC_AOS_URL`, `NEXT_PUBLIC_AOS_PUBLISHABLE_KEY` | a Next.js frontend |

### Own database, no separate auth server

In production, a Node app can run the engine itself, on the app's own Postgres, with `startLocal()` from `@aos-auth/node`. The SDK downloads the engine release, starts it beside your app, and stops it with your process. See [packages/node](packages/node#run-the-engine-on-your-own-database-startlocal).

## Developing this repo

It is an npm workspace. Node 20+ is recommended.

```
packages/js/      @aos-auth/js     src/ (client, types, errors, passkeys)   test/client.test.mjs
packages/react/   @aos-auth/react  src/ (provider, hooks, screens, routes)  test/react.test.mjs, styles.css
packages/node/    @aos-auth/node   src/ (client, token, express, web, webhook, local)  test/node.test.mjs
test-integration/ tests against a real engine
```

```sh
npm install
npm run build                 # builds js, then react, then node (tsc)
npm test                      # builds, then runs the unit tests (no engine or database needed)
npm run test:integration      # against a running engine
```

The integration tests skip themselves unless you point them at an engine:

| Variable | For |
| --- | --- |
| `AOS_IT_URL`, `AOS_IT_PUBLISHABLE_KEY`, `AOS_IT_SECRET_KEY` | `engine.test.mjs`: a running engine and a tenant's keys |
| `AOS_IT_ENGINE`, `AOS_IT_DATABASE_URL`, `AOS_IT_MASTER_KEY` | `local.test.mjs`: an engine program and a **throwaway** Postgres for `startLocal` |

### Publishing

```sh
npm run build
npm publish -w @aos-auth/js && npm publish -w @aos-auth/react && npm publish -w @aos-auth/node
```

`@aos-auth/react` depends on `@aos-auth/js` at the same version, so publish `js` first.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
