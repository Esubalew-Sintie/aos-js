export interface Claims {
  /** The signed-in person (the "sub" claim). */
  userId: string;
  sessionId: string;
  tenantId: string;
  /** The active organization's id in the application, if any. */
  organization?: string;
  /** Its resource id in the engine. */
  organizationId?: string;
  /** 0 nothing verified, 1 email, 2 phone. */
  assuranceLevel: number;
  type?: string;
  issuedAt: number;
  expiresAt: number;
}

/** Something in the application: {type: "tenant", id: "root"} is the top. */
export interface Resource { type: string; id: string }

export interface CanRequest {
  principal_id: string;
  permission: string;
  resource: Resource;
  /** Lets permissions that need a fresh second factor pass. */
  session_id?: string;
  /** What grant conditions read, such as {request: {amount: 500}}. */
  context?: Record<string, unknown>;
  agent_id?: string;
  approval_id?: string;
  details?: Record<string, unknown>;
  scopes?: string[];
}

export interface CanResult {
  allowed: boolean;
  /** allowed, no_matching_grant, denied_by_grant, step_up_required, approval_required, condition_not_met, ... */
  reason: string;
  grant_id?: string;
  role?: string;
  approval_id?: string;
  delegation_id?: string;
}

export interface FilterResult { resource_type: string; allowed: string[]; conditional: string[]; truncated: boolean }

export interface Permission { name: string; description?: string; step_up_seconds?: number; needs_approval?: boolean; source?: string }
export interface Role { id?: string; name: string; description?: string; source?: string; permissions: string[] }
export interface Grant {
  id?: string;
  principal_id?: string;
  group_id?: string;
  role: string;
  resource: Resource;
  effect?: "allow" | "deny";
  condition?: string;
  expires_at?: string;
  reason?: string;
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  status: string;
  email_verified: boolean;
  assurance_level: number;
  created_at: string;
  guest?: boolean;
}

export interface UserPage { users: User[]; next_cursor?: string }

export interface Organization { id: string; slug: string; name: string; created_at: string }
export interface Member { principal_id: string; email?: string; name?: string; status: string; roles: string[] }

export interface APIKey { id: string; principal_id: string; name: string; public_id: string; scopes: string[]; key?: string }
export interface KeyCheck { key_id: string; principal_id: string; kind: string; scopes: string[]; allowed: boolean; reason?: string }

export interface Webhook { id: string; kind: string; url: string; event_types: string[]; secret?: string }
export interface WebhookEvent<T = unknown> { id: string; event: string; created_at: string; data: T }

export interface Options {
  /** The engine's address, such as https://auth.example.com. */
  url: string;
  /** Needed to verify tokens (it opens the public keys). */
  publishableKey?: string;
  /** sk_...: needed for every backend call. Keep it on the server. */
  secretKey?: string;
  /** How long fetched public keys are trusted, in ms. Default 10 minutes. */
  keysTtlMs?: number;
  fetch?: typeof fetch;
  /** For tests. */
  now?: () => number;
}
