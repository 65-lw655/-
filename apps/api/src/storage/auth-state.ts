import type {
  AccountStatus,
  CredentialStatus,
  SystemRole
} from "@project-online/domain";

export interface StoredUser {
  id: string;
  username: string;
  normalizedUsername: string;
  displayName: string;
  role: SystemRole;
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionRevocationReason =
  | "LOGOUT"
  | "ROTATED"
  | "ACCOUNT_DISABLED"
  | "ROLE_CHANGED"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED";

export interface StoredSession {
  id: string;
  userId: string;
  tokenDigest: string;
  deviceId: string;
  platform: "WEB";
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revocationReason: SessionRevocationReason | null;
}

export type CredentialTicketPurpose = "ACTIVATION" | "PASSWORD_RESET";

export interface StoredCredentialTicket {
  id: string;
  userId: string;
  purpose: CredentialTicketPurpose;
  ticketDigest: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface StoredLoginAttempt {
  usernameDigest: string;
  sourceDigest: string;
  failedAt: string;
}

export type SecurityAuditEventType =
  | "BOOTSTRAP_ADMIN"
  | "USER_CREATED"
  | "ACTIVATION_REISSUED"
  | "USER_ACTIVATED"
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "LOGIN_RATE_LIMITED"
  | "SESSION_REFRESHED"
  | "SESSION_LOGGED_OUT"
  | "USER_DISABLED"
  | "USER_ENABLED"
  | "USER_ROLE_CHANGED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_ISSUED"
  | "PASSWORD_RESET_COMPLETED"
  | "AUTHORIZATION_DENIED";

export type SecurityAuditResult = "SUCCEEDED" | "DENIED";

export interface StoredSecurityAuditEvent {
  id: string;
  event: SecurityAuditEventType;
  result: SecurityAuditResult;
  actorId: string | null;
  targetId: string | null;
  projectId: string | null;
  sourceDigest: string | null;
  occurredAt: string;
}

export interface AuthState {
  version: 1;
  users: StoredUser[];
  sessions: StoredSession[];
  tickets: StoredCredentialTicket[];
  loginAttempts: StoredLoginAttempt[];
  auditEvents: StoredSecurityAuditEvent[];
}

export interface AuthStateStore {
  read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T>;
  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T>;
}
