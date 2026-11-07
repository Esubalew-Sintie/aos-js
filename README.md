# aos-js

The JavaScript SDKs for AOS, the identity engine. One workspace, three packages:

| Package | For |
| --- | --- |
| [`@aos-auth/js`](packages/js) | Browsers and React Native |
| [`@aos-auth/react`](packages/react) | React and Next.js: screens, hooks, `<Protect>`, the `/auth` pages |
| [`@aos-auth/node`](packages/node) | Node backends: tokens, permissions, admin calls, webhooks; Express and Next.js helpers |

The browser talks to the engine directly with the publishable key. Your backend checks the short-lived token the browser sends and asks the engine about permissions with the secret key.

## Develop

```sh
npm install
npm test                      # builds the three packages and runs the unit tests
npm run test:integration      # against a running engine: needs AOS_IT_URL, AOS_IT_PUBLISHABLE_KEY, AOS_IT_SECRET_KEY
```

## Publish

```sh
npm run build
npm publish -w @aos-auth/js && npm publish -w @aos-auth/react && npm publish -w @aos-auth/node
```

`@aos-auth/react` depends on `@aos-auth/js` at the same version, so `js` goes first.
