import { useCallback, useEffect, useState } from "react";
import type { AosClient, Organization, Session, User } from "@aos-auth/js";
import { useAosContext, type Resource } from "./context.js";

/** The client, for calls the components do not cover. */
export function useAos(): AosClient {
  return useAosContext().client;
}

export function useSession(): { loaded: boolean; session: Session | null } {
  const { session } = useAosContext();
  return { loaded: session !== undefined, session: session ?? null };
}

export function useUser(): { loaded: boolean; isSignedIn: boolean; user: User | null } {
  const { session } = useAosContext();
  return { loaded: session !== undefined, isSignedIn: !!session, user: session?.user ?? null };
}

/** The organizations the person belongs to, the active one, and switch(). */
export function useOrganization() {
  const { client, session } = useAosContext();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const userId = session?.user.id;
  const reload = useCallback(async () => {
    if (!userId) { setOrganizations(null); return; }
    setOrganizations(await client.listOrganizations());
  }, [client, userId]);
  useEffect(() => { reload().catch(() => setOrganizations([])); }, [reload]);
  const activeId = session?.session.active_organization_id;
  return {
    loaded: organizations !== null,
    organizations: organizations ?? [],
    active: organizations?.find((o) => o.id === activeId) ?? null,
    switchTo: (id: string) => client.switchOrganization(id),
    create: async (name: string) => { const o = await client.createOrganization(name); await reload(); return o; },
    reload,
  };
}

/** Asks your backend whether the person holds a permission. */
export function usePermission(permission: string, resource?: Resource): { loaded: boolean; allowed: boolean } {
  const { can, session } = useAosContext();
  const [state, setState] = useState({ loaded: false, allowed: false });
  const key = resource ? `${resource.type}:${resource.id}` : "";
  const orgId = session?.session.active_organization_id;
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setState({ loaded: true, allowed: false }); return; }
    let live = true;
    can([permission], resource).then(
      (r) => live && setState({ loaded: true, allowed: !!r[permission] }),
      () => live && setState({ loaded: true, allowed: false }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, key, session?.user.id, orgId, can]);
  return state;
}

/** A query parameter from the current address (empty during server rendering). */
export function useQueryParam(name: string, given?: string): string {
  const [v, setV] = useState(given ?? "");
  useEffect(() => {
    if (given !== undefined || typeof window === "undefined") return;
    setV(new URLSearchParams(window.location.search).get(name) ?? "");
  }, [name, given]);
  return v;
}
