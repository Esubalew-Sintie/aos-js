import { useEffect, useState, type ReactNode } from "react";
import { AccountSetup, AcceptInvitation, ConfirmEmail, ForgotPassword, MagicLink, ResetPassword, SignIn, SignUp, VerifyEmail, type SignInProps } from "./auth.js";
import { useAosContext } from "./context.js";
import { useQueryParam } from "./hooks.js";

/** The page each /auth path shows. The engine's emails link to these paths. */
export function routeFor(pathname: string, base = "/auth"): string | null {
  const p = pathname.replace(/\/+$/, "");
  if (!p.startsWith(base + "/")) return null;
  const page = p.slice(base.length + 1);
  return ["sign-in", "sign-up", "verify-email", "reset-password", "forgot-password", "confirm-email", "setup", "invitation", "magic-link", "sso/callback"].includes(page) ? page : null;
}

/** Only same-site paths may be redirected to after sign-in. */
export function safeRedirect(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/**
 * Every /auth page in one component. Mount it on /auth/* in your router
 * (or as app/auth/[...page]/page.tsx in Next.js).
 */
export function AuthRoutes(props: { pathname?: string; base?: string; signIn?: SignInProps; notFound?: ReactNode }) {
  const { afterSignInUrl } = useAosContext();
  const [pathname, setPathname] = useState(props.pathname ?? "");
  useEffect(() => {
    if (props.pathname !== undefined || typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [props.pathname]);
  const redirect = safeRedirect(useQueryParam("redirect_url"), afterSignInUrl);

  const page = routeFor(pathname, props.base);
  let content: ReactNode;
  switch (page) {
    case "sso/callback":
    case "sign-in": content = <SignIn {...props.signIn} redirectUrl={redirect} />; break;
    case "sign-up": content = <SignUp redirectUrl={redirect} />; break;
    case "verify-email": content = <VerifyEmail redirectUrl={redirect} />; break;
    case "reset-password": content = <ResetPassword />; break;
    case "forgot-password": content = <ForgotPassword />; break;
    case "confirm-email": content = <ConfirmEmail />; break;
    case "setup": content = <AccountSetup redirectUrl={redirect} />; break;
    case "invitation": content = <AcceptInvitation redirectUrl={redirect} />; break;
    case "magic-link": content = <MagicLink redirectUrl={redirect} />; break;
    default: content = pathname ? props.notFound ?? null : null;
  }
  return <div className="aos-page">{content}</div>;
}
