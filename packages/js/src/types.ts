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

export interface SessionInfo {
  id: string;
  expires_at: string;
  second_factor_at?: string;
  active_organization_id?: string;
  active_organization?: string;
}

export interface Session {
  user: User;
  session: SessionInfo;
}

/** What a sign-in step ends with. */
export type SignInResult =
  | { status: "signed_in"; user: User; session: SessionInfo; secondFactorSetupRequired: boolean }
  | { status: "second_factor"; methods: string[] };

export interface Organization {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface Member {
  principal_id: string;
  email?: string;
  name?: string;
  status: string;
  roles: string[];
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  organization_id?: string;
  organization_name?: string;
  invited_by?: string;
  expires_at: string;
}

export interface InvitationPreview {
  email: string;
  role: string;
  organization_name: string;
  invited_by?: string;
  expires_at: string;
  account_exists: boolean;
}

export interface Factors {
  totp: boolean;
  passkeys: number;
  recovery_codes_left: number;
  second_factor_at?: string;
  required: boolean;
}

export interface Passkey {
  id: string;
  name?: string;
  transports: string[];
  backed_up: boolean;
  created_at: string;
  last_used_at?: string;
}

export interface DeviceSession {
  id: string;
  current: boolean;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip?: string;
  user_agent?: string;
  auth_methods: string[];
}

/** A key/value store for tokens. localStorage fits; on React Native use
 * a secure store (for example expo-secure-store) wrapped to this shape. */
export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface ClientOptions {
  /** The engine's address, such as https://auth.example.com. */
  url: string;
  /** The tenant's publishable key (pk_...). Safe to ship in browser code. */
  publishableKey: string;
  /**
   * "browser" (default): the session is a host-locked cookie in
   * production; development tenants hand it back and it travels in a header.
   * "token": an access and a refresh token, for mobile apps.
   */
  sessionKind?: "browser" | "token";
  /** Where development and token sessions are kept. Defaults to
   * localStorage when there is one, else memory. */
  storage?: TokenStorage;
  fetch?: typeof fetch;
}
