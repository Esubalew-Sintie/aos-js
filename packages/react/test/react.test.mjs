import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import {
  AosProvider, AuthRoutes, SignIn, SignUp, SignedIn, SignedOut, UserButton, OrganizationSwitcher, Protect,
  routeFor, safeRedirect, messageOf, AosError, useUser,
} from "../dist/index.js";

const user = { id: "u1", email: "ana@example.com", name: "Ana Bekele", status: "active", email_verified: true, assurance_level: 1, created_at: "" };
const session = { user, session: { id: "s1", expires_at: "" } };
const base = { url: "http://engine.test", publishableKey: "pk_test_1", fetch: async () => new Response("{}") };
const render = (el, initialSession) => renderToString(h(AosProvider, { ...base, initialSession }, el));

test("SignedIn, SignedOut and UserButton follow the session", () => {
  const tree = h("div", null, h(SignedIn, null, "IN"), h(SignedOut, null, "OUT"), h(UserButton));
  const signedIn = render(tree, session);
  assert.match(signedIn, /IN/);
  assert.doesNotMatch(signedIn, /OUT/);
  assert.match(signedIn, />AB</, "initials of the name");
  const out = render(tree, null);
  assert.match(out, /OUT/);
  assert.doesNotMatch(out, /aos-avatar/);
  // While loading (no initial session), neither branch shows.
  const loading = render(tree, undefined);
  assert.doesNotMatch(loading, /IN|OUT/);
});

test("hooks read the session", () => {
  function Name() { const { user, isSignedIn } = useUser(); return h("span", null, isSignedIn ? user.email : "anon"); }
  assert.match(render(h(Name), session), /ana@example.com/);
  assert.match(render(h(Name), null), /anon/);
});

test("components outside a provider say what is missing", () => {
  assert.throws(() => renderToString(h(SignedIn, null, "x")), /AosProvider/);
});

test("SignIn shows the form, social buttons and links", () => {
  const html = render(h(SignIn, { socialProviders: ["google", "microsoft"], sso: true }), null);
  for (const s of ['name="email"', 'name="password"', 'autoComplete="current-password"', "Continue with Google", "Continue with Microsoft", "Forgot password?", "/auth/sign-up", "Email me a code", "Sign in with your company"]) {
    assert.ok(html.includes(s) || html.includes(s.replace("autoComplete", "autocomplete")), s);
  }
  const plain = render(h(SignIn, { emailCode: false }), null);
  assert.doesNotMatch(plain, /Email me a code|Continue with/);
});

test("SignUp asks for name, email and a new password", () => {
  const html = render(h(SignUp), null);
  assert.match(html, /name="name"/);
  assert.match(html, /new-password/);
  assert.match(html, /\/auth\/sign-in/);
});

test("AuthRoutes picks the page from the path", () => {
  const page = (p) => render(h(AuthRoutes, { pathname: p }), null);
  assert.match(page("/auth/sign-in"), /Sign in/);
  assert.match(page("/auth/sign-up"), /Create your account/);
  assert.match(page("/auth/forgot-password/"), /Reset your password/);
  assert.match(page("/auth/reset-password"), /Choose a new password/);
  assert.match(page("/auth/verify-email"), /Confirming your email/);
  assert.match(page("/auth/setup"), /Set up your account/);
  assert.match(page("/auth/invitation"), /Invitation/);
  assert.match(page("/auth/magic-link"), /Signing you in/);
  assert.match(page("/auth/sso/callback"), /Sign in/);
  assert.doesNotMatch(page("/auth/nope"), /aos-card/);
});

test("routeFor and safeRedirect", () => {
  assert.equal(routeFor("/auth/setup"), "setup");
  assert.equal(routeFor("/login/sign-in", "/login"), "sign-in");
  assert.equal(routeFor("/other"), null);
  assert.equal(safeRedirect("/billing?x=1", "/"), "/billing?x=1");
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", null]) assert.equal(safeRedirect(bad, "/"), "/");
});

test("Protect renders nothing until the answer arrives", () => {
  const html = render(h(Protect, { permission: "invoice.refund", fallback: "NO" }, "YES"), session);
  assert.doesNotMatch(html, /YES|NO/);
});

test("OrganizationSwitcher shows only when signed in", () => {
  assert.match(render(h(OrganizationSwitcher), session), /aos-switcher/);
  assert.doesNotMatch(render(h(OrganizationSwitcher), null), /aos-switcher/);
});

test("messageOf turns engine errors into sentences", () => {
  assert.equal(messageOf(new AosError(401, "invalid_credentials", "wrong email or password")), "Wrong email or password.");
  assert.equal(messageOf(new AosError(429, "rate_limited", "too many", "", { retry_after: "30" })), "Too many attempts. Try again in 30 seconds.");
  assert.match(messageOf(new TypeError("fetch failed")), /connection/);
});
