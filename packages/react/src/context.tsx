import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type AosClient, type ClientOptions, type Session } from "@aos-auth/js";

export interface Resource { type: string; id: string }

/** Answers permission questions for <Protect> and usePermission. */
export type CanFunction = (permissions: string[], resource?: Resource) => Promise<Record<string, boolean>>;

export interface AosContextValue {
  client: AosClient;
  /** undefined while loading, null when signed out. */
  session: Session | null | undefined;
  can: CanFunction;
  navigate: (to: string) => void;
  paths: AuthPaths;
  afterSignInUrl: string;
  afterSignOutUrl: string;
}

/** Where the /auth pages live. The email links the engine sends use these paths. */
export interface AuthPaths {
  signIn: string;
  signUp: string;
  forgotPassword: string;
}

const defaultPaths: AuthPaths = { signIn: "/auth/sign-in", signUp: "/auth/sign-up", forgotPassword: "/auth/forgot-password" };

const Ctx = createContext<AosContextValue | null>(null);

export interface AosProviderProps extends Partial<ClientOptions> {
  children?: ReactNode;
  /** An existing client; otherwise one is made from url and publishableKey. */
  client?: AosClient;
  /**
   * Your backend's route that answers permission questions
   * (see canHandler in @aos-auth/node). Default "/api/aos/can".
   */
  canEndpoint?: string;
  /** Replace how permission questions are answered. */
  can?: CanFunction;
  /** Your router's navigate; defaults to a full page load. */
  navigate?: (to: string) => void;
  paths?: Partial<AuthPaths>;
  afterSignInUrl?: string;
  afterSignOutUrl?: string;
  /** For server rendering: the session already known, or null. */
  initialSession?: Session | null;
}

export function AosProvider(props: AosProviderProps) {
  const clientRef = useRef<AosClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = props.client ?? createClient({
      url: props.url ?? "",
      publishableKey: props.publishableKey ?? "",
      sessionKind: props.sessionKind,
      storage: props.storage,
      fetch: props.fetch,
    });
  }
  const client = clientRef.current;
  const [session, setSession] = useState<Session | null | undefined>(props.initialSession);

  useEffect(() => {
    const off = client.onChange(setSession);
    client.getSession().then(setSession, () => setSession(null));
    return off;
  }, [client]);

  const endpoint = props.canEndpoint ?? "/api/aos/can";
  const defaultCan = useCallback<CanFunction>(async (permissions, resource) => {
    const res = await client.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions, resource }),
    });
    if (!res.ok) return Object.fromEntries(permissions.map((p) => [p, false]));
    return ((await res.json()) as { results: Record<string, boolean> }).results ?? {};
  }, [client, endpoint]);

  const value = useMemo<AosContextValue>(() => ({
    client,
    session,
    can: props.can ?? defaultCan,
    navigate: props.navigate ?? ((to) => { if (typeof window !== "undefined") window.location.assign(to); }),
    paths: { ...defaultPaths, ...props.paths },
    afterSignInUrl: props.afterSignInUrl ?? "/",
    afterSignOutUrl: props.afterSignOutUrl ?? "/",
  }), [client, session, props.can, defaultCan, props.navigate, props.paths, props.afterSignInUrl, props.afterSignOutUrl]);

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useAosContext(): AosContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("aos: wrap your app in <AosProvider>");
  return v;
}
