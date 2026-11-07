import { useEffect, useRef, useState } from "react";
import type { InvitationPreview, SignInResult } from "@aos-auth/js";
import { useAosContext } from "./context.js";
import { useQueryParam } from "./hooks.js";
import { Button, Card, ErrorText, Field, Notice, messageOf, useAction } from "./ui.js";

function useFinish(redirectUrl?: string) {
  const { navigate, afterSignInUrl } = useAosContext();
  return (r: SignInResult) => { if (r.status === "signed_in") navigate(redirectUrl ?? afterSignInUrl); };
}

export interface SignInProps {
  /** Social providers set up for the tenant, such as ["google", "microsoft"]. */
  socialProviders?: string[];
  /** Show "Sign in with your company" (enterprise SSO by email domain). */
  sso?: boolean;
  /** Offer passkeys. Default true when the browser supports them. */
  passkeys?: boolean;
  /** Offer a one-time code by email. Default true. */
  emailCode?: boolean;
  redirectUrl?: string;
}

type Pending = { kind: "social" | "sso"; provider?: string };
const PENDING_KEY = "aos.redirect";
function readPending(): Pending | null {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null"); } catch { return null; }
}
function writePending(p: Pending | null) {
  try { if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); else sessionStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ }
}

const providerName: Record<string, string> = { google: "Google", microsoft: "Microsoft", apple: "Apple", github: "GitHub", gitlab: "GitLab" };

export function SignIn(props: SignInProps) {
  const { client, paths } = useAosContext();
  const finish = useFinish(props.redirectUrl);
  const [step, setStep] = useState<"password" | "second" | "code" | "code-sent" | "sso">("password");
  const [methods, setMethods] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);
  const a = useAction();

  useEffect(() => {
    setCanPasskey(props.passkeys !== false && typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, [props.passkeys]);

  // Back from Google, Microsoft or a company's identity provider: finish.
  const finishing = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || finishing.current) return;
    const q = new URLSearchParams(window.location.search);
    const state = q.get("state"), code = q.get("code");
    const pending = readPending();
    if (!state || !code || !pending) return;
    finishing.current = true;
    writePending(null);
    const params = { state, code };
    a.run(async () => after(pending.kind === "sso" ? await client.finishSSO(params) : await client.finishSocial(pending.provider ?? "", params)))();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const after = (r: SignInResult) => {
    if (r.status === "second_factor") { setMethods(r.methods); setCode(""); setStep("second"); return; }
    finish(r);
  };
  const back = () => { a.setError(""); setStep("password"); };
  const redirectBack = () => (typeof window === "undefined" ? "" : window.location.origin + window.location.pathname);
  const goSocial = (provider: string) => a.run(async () => {
    const to = await client.startSocial(provider, redirectBack());
    writePending({ kind: "social", provider });
    window.location.assign(to);
  })();

  if (step === "second") {
    return (
      <Card title="Two-step verification" subtitle={useRecovery ? "Enter one of your recovery codes." : "Enter the code from your authenticator app."}>
        <form onSubmit={a.run(async () => after(await client.secondFactor({ method: useRecovery ? "recovery_code" : "totp", code })))}>
          <Field label={useRecovery ? "Recovery code" : "Code"} name="code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode={useRecovery ? "text" : "numeric"} autoFocus />
          <ErrorText error={a.error} />
          <Button busy={a.busy}>Continue</Button>
        </form>
        {methods.includes("passkey") ? <Button kind="secondary" onClick={() => a.run(async () => after(await client.secondFactor({ method: "passkey" })))()}>Use a passkey</Button> : null}
        {methods.includes("recovery_code") ? <Button kind="link" onClick={() => setUseRecovery(!useRecovery)}>{useRecovery ? "Use your authenticator app" : "Use a recovery code"}</Button> : null}
      </Card>
    );
  }

  if (step === "code" || step === "code-sent") {
    return (
      <Card title="Sign in with a code" subtitle={step === "code-sent" ? <>We sent a code to <b>{email}</b>. It also works as a link.</> : "We'll email you a 6-digit code."}>
        {step === "code" ? (
          <form onSubmit={a.run(async () => { await client.sendCode(email); setStep("code-sent"); })}>
            <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
            <ErrorText error={a.error} />
            <Button busy={a.busy}>Send code</Button>
          </form>
        ) : (
          <form onSubmit={a.run(async () => after(await client.verifyCode(email, code)))}>
            <Field label="Code" name="code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" autoFocus />
            <ErrorText error={a.error} />
            <Button busy={a.busy}>Sign in</Button>
          </form>
        )}
        <Button kind="link" onClick={back}>Use a password instead</Button>
      </Card>
    );
  }

  if (step === "sso") {
    return (
      <Card title="Sign in with your company" subtitle="Enter your work email.">
        <form onSubmit={a.run(async () => { const to = await client.startSSO(email, redirectBack()); writePending({ kind: "sso" }); window.location.assign(to); })}>
          <Field label="Work email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
          <ErrorText error={a.error} />
          <Button busy={a.busy}>Continue</Button>
        </form>
        <Button kind="link" onClick={back}>Back</Button>
      </Card>
    );
  }

  return (
    <Card title="Sign in" footer={<>No account? <a href={paths.signUp}>Sign up</a></>}>
      {(props.socialProviders ?? []).map((p) => (
        <Button key={p} kind="secondary" onClick={() => goSocial(p)}>
          {`Continue with ${providerName[p] ?? p}`}
        </Button>
      ))}
      {canPasskey ? <Button kind="secondary" onClick={() => a.run(async () => after(await client.signInWithPasskey()))()}>Sign in with a passkey</Button> : null}
      {(props.socialProviders?.length || canPasskey) ? <div className="aos-divider"><span>or</span></div> : null}
      <form onSubmit={a.run(async () => after(await client.signIn({ email, password })))}>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" inputMode="email" />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Sign in</Button>
      </form>
      <div className="aos-links">
        <a href={paths.forgotPassword}>Forgot password?</a>
        {props.emailCode !== false ? <Button kind="link" onClick={() => { a.setError(""); setStep("code"); }}>Email me a code</Button> : null}
        {props.sso ? <Button kind="link" onClick={() => { a.setError(""); setStep("sso"); }}>Sign in with your company</Button> : null}
      </div>
    </Card>
  );
}

export function SignUp(props: { redirectUrl?: string }) {
  const { client, paths } = useAosContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const a = useAction();
  if (sent) {
    return <Card title="Check your email" subtitle={<>If <b>{email}</b> can be used, a confirmation link is on its way. Open it to finish.</>} />;
  }
  return (
    <Card title="Create your account" footer={<>Have an account? <a href={paths.signIn}>Sign in</a></>}>
      <form onSubmit={a.run(async () => { await client.signUp({ email, password, name: name || undefined }); setSent(true); })}>
        <Field label="Name" name="name" value={name} onChange={setName} autoComplete="name" required={false} />
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Sign up</Button>
      </form>
    </Card>
  );
}

/** Runs a one-shot action with the token from the address, once. */
function useTokenAction(token: string, fn: (token: string) => Promise<void>) {
  const [state, setState] = useState<{ done: boolean; error: string }>({ done: false, error: "" });
  const ran = useRef(false);
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    fn(token).then(() => setState({ done: true, error: "" }), (e) => setState({ done: true, error: messageOf(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return state;
}

export function VerifyEmail(props: { token?: string; redirectUrl?: string }) {
  const { client, paths } = useAosContext();
  const token = useQueryParam("token", props.token);
  const finish = useFinish(props.redirectUrl);
  const s = useTokenAction(token, async (t) => finish(await client.verifyEmail(t)));
  if (s.error) return <Card title="This link didn't work" subtitle={s.error} footer={<a href={paths.signIn}>Back to sign in</a>} />;
  return <Card title="Confirming your email" subtitle="One moment…" />;
}

export function MagicLink(props: { token?: string; redirectUrl?: string }) {
  const { client, paths } = useAosContext();
  const token = useQueryParam("token", props.token);
  const finish = useFinish(props.redirectUrl);
  const s = useTokenAction(token, async (t) => finish(await client.magicLink(t)));
  if (s.error) return <Card title="This link didn't work" subtitle={s.error} footer={<a href={paths.signIn}>Back to sign in</a>} />;
  return <Card title="Signing you in" subtitle="One moment…" />;
}

export function ConfirmEmail(props: { token?: string }) {
  const { client } = useAosContext();
  const token = useQueryParam("token", props.token);
  const s = useTokenAction(token, async (t) => { await client.confirmEmail(t); });
  if (s.error) return <Card title="This link didn't work" subtitle={s.error} />;
  return <Card title={s.done ? "Email address changed" : "Confirming…"} subtitle={s.done ? "Use the new address from now on." : undefined} />;
}

export function ForgotPassword() {
  const { client, paths } = useAosContext();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const a = useAction();
  if (sent) return <Card title="Check your email" subtitle={<>If <b>{email}</b> has an account, a link to reset the password is on its way.</>} footer={<a href={paths.signIn}>Back to sign in</a>} />;
  return (
    <Card title="Reset your password" footer={<a href={paths.signIn}>Back to sign in</a>}>
      <form onSubmit={a.run(async () => { await client.forgotPassword(email); setSent(true); })}>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Send link</Button>
      </form>
    </Card>
  );
}

export function ResetPassword(props: { token?: string }) {
  const { client, paths } = useAosContext();
  const token = useQueryParam("token", props.token);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const a = useAction();
  if (done) return <Card title="Password changed" subtitle="You were signed out everywhere. Sign in with the new password." footer={<a href={paths.signIn}>Sign in</a>} />;
  return (
    <Card title="Choose a new password">
      <form onSubmit={a.run(async () => { await client.resetPassword(token, password); setDone(true); })}>
        <Field label="New password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Save password</Button>
      </form>
    </Card>
  );
}

/** Finishes an account an admin created: the person chooses a password. */
export function AccountSetup(props: { token?: string; redirectUrl?: string }) {
  const { client } = useAosContext();
  const token = useQueryParam("token", props.token);
  const finish = useFinish(props.redirectUrl);
  const [password, setPassword] = useState("");
  const a = useAction();
  return (
    <Card title="Set up your account" subtitle="Choose a password to finish.">
      <form onSubmit={a.run(async () => finish(await client.setupAccount(token, password)))}>
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Finish</Button>
      </form>
    </Card>
  );
}

export function AcceptInvitation(props: { token?: string; redirectUrl?: string }) {
  const { client, session, paths, navigate, afterSignInUrl } = useAosContext();
  const token = useQueryParam("token", props.token);
  const finish = useFinish(props.redirectUrl);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const a = useAction();
  useEffect(() => {
    if (!token) return;
    client.previewInvitation(token).then(setPreview, (e) => setLoadError(messageOf(e)));
  }, [client, token]);

  if (loadError) return <Card title="This invitation can't be used" subtitle={loadError} />;
  if (!preview) return <Card title="Invitation" subtitle="Loading…" />;
  const title = `Join ${preview.organization_name}`;
  const subtitle = <>{preview.invited_by ? <>{preview.invited_by} invited </> : <>You were invited </>}<b>{preview.email}</b> as {preview.role}.</>;

  if (session) {
    const accept = a.run(async () => {
      const org = await client.acceptInvitation(token);
      await client.switchOrganization(org.id);
      navigate(props.redirectUrl ?? afterSignInUrl);
    });
    return (
      <Card title={title} subtitle={subtitle}>
        <ErrorText error={a.error} />
        <Button busy={a.busy} onClick={() => accept()}>Accept</Button>
        <Button kind="secondary" onClick={() => a.run(async () => { await client.declineInvitation(token); navigate(afterSignInUrl); })()}>Decline</Button>
      </Card>
    );
  }
  if (preview.account_exists) {
    const here = typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
    return <Card title={title} subtitle={subtitle} footer={<a href={`${paths.signIn}?redirect_url=${encodeURIComponent(here)}`}>Sign in to accept</a>} />;
  }
  return (
    <Card title={title} subtitle={subtitle}>
      <form onSubmit={a.run(async () => finish(await client.signUpWithInvitation(token, password, name || undefined)))}>
        <Field label="Name" name="name" value={name} onChange={setName} autoComplete="name" required={false} />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <ErrorText error={a.error} />
        <Button busy={a.busy}>Create account and join</Button>
      </form>
    </Card>
  );
}

export { Notice };
