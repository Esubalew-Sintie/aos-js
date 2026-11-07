import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAosContext, type Resource } from "./context.js";
import { useOrganization, usePermission } from "./hooks.js";
import { messageOf } from "./ui.js";

/** Renders its children only when someone is signed in. */
export function SignedIn({ children }: { children?: ReactNode }) {
  const { session } = useAosContext();
  return session ? <>{children}</> : null;
}

/** Renders its children only when nobody is signed in (not while loading). */
export function SignedOut({ children }: { children?: ReactNode }) {
  const { session } = useAosContext();
  return session === null ? <>{children}</> : null;
}

/**
 * Shows its children only when the person holds the permission. This hides
 * buttons; it is not security. Your backend must check again.
 */
export function Protect(props: { permission: string; resource?: Resource; fallback?: ReactNode; children?: ReactNode }) {
  const { loaded, allowed } = usePermission(props.permission, props.resource);
  if (!loaded) return null;
  return <>{allowed ? props.children : props.fallback ?? null}</>;
}

/** Sends a signed-out visitor to the sign-in page. */
export function RedirectToSignIn() {
  const { session, navigate, paths } = useAosContext();
  useEffect(() => {
    if (session !== null || typeof window === "undefined") return;
    navigate(`${paths.signIn}?redirect_url=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [session, navigate, paths.signIn]);
  return null;
}

function initials(name?: string, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 && name ? parts[1][0] : "")).toUpperCase();
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

/** The signed-in person's avatar with a menu: their email and sign out. */
export function UserButton(props: { children?: ReactNode }) {
  const { client, session, navigate, afterSignOutUrl } = useAosContext();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!session) return null;
  const { user } = session;
  return (
    <div className="aos-menu" ref={ref}>
      <button className="aos-avatar" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={user.email}>
        {initials(user.name, user.email)}
      </button>
      {open ? (
        <div className="aos-menu-panel" role="menu">
          <div className="aos-menu-head">
            {user.name ? <div className="aos-menu-name">{user.name}</div> : null}
            <div className="aos-menu-email">{user.email}</div>
          </div>
          {props.children}
          <button className="aos-menu-item" role="menuitem" type="button" onClick={async () => {
            setOpen(false);
            await client.signOut().catch(() => undefined);
            navigate(afterSignOutUrl);
          }}>Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

/** Lists the person's organizations; picks the active one; creates one. */
export function OrganizationSwitcher(props: { allowCreate?: boolean; personalLabel?: string }) {
  const org = useOrganization();
  const { session } = useAosContext();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const ref = useDismiss(open, () => setOpen(false));
  if (!session) return null;
  const label = org.active?.name ?? props.personalLabel ?? "Choose organization";
  return (
    <div className="aos-menu" ref={ref}>
      <button className="aos-switcher" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open ? (
        <div className="aos-menu-panel" role="menu">
          {org.organizations.map((o) => (
            <button key={o.id} className="aos-menu-item" role="menuitemradio" aria-checked={o.id === org.active?.id} type="button"
              onClick={async () => { setOpen(false); await org.switchTo(o.id).catch((e) => setError(messageOf(e))); }}>
              {o.name}
            </button>
          ))}
          {props.allowCreate !== false ? (creating ? (
            <form className="aos-menu-form" onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const o = await org.create(name);
                await org.switchTo(o.id);
                setName(""); setCreating(false); setOpen(false);
              } catch (err) { setError(messageOf(err)); }
            }}>
              <input className="aos-input" aria-label="Organization name" placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              <button className="aos-button aos-button-primary" type="submit">Create</button>
            </form>
          ) : (
            <button className="aos-menu-item" type="button" onClick={() => setCreating(true)}>+ New organization</button>
          )) : null}
          {error ? <p className="aos-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
