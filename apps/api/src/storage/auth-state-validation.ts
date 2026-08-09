import type {
  AuthState,
  StoredCredentialTicket,
  StoredLoginAttempt,
  StoredSecurityAuditEvent,
  StoredSession,
  StoredUser
} from "./auth-state.js";

type Validator = (value: unknown) => boolean;
type Shape<T extends object> = { [Key in keyof T]-?: Validator };

function isString(value: unknown): boolean {
  return typeof value === "string";
}

function isIsoTimestamp(value: unknown): boolean {
  if (!isString(value)) {
    return false;
  }

  const timestamp = Date.parse(value as string);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === (value as string)
  );
}

function isNullable(validator: Validator): Validator {
  return (value) => value === null || validator(value);
}

function isOneOf(...allowed: readonly string[]): Validator {
  return (value) => isString(value) && allowed.includes(value as string);
}

function isExactObject<T extends object>(shape: Shape<T>): Validator {
  return (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const record = value as Record<string, unknown>;
    const entries = Object.entries(shape) as [string, Validator][];
    return (
      Object.keys(record).length === entries.length &&
      entries.every(
        ([key, validator]) =>
          Object.hasOwn(record, key) && validator(record[key])
      )
    );
  };
}

function isArrayOf(validator: Validator): Validator {
  return (value) => Array.isArray(value) && value.every(validator);
}

const isStoredUser = isExactObject<StoredUser>({
  id: isString,
  username: isString,
  normalizedUsername: isString,
  displayName: isString,
  role: isOneOf("USER", "LEADER", "ADMIN"),
  accountStatus: isOneOf("ACTIVE", "DISABLED"),
  credentialStatus: isOneOf("PENDING_ACTIVATION", "READY", "RESET_REQUIRED"),
  passwordHash: isNullable(isString),
  createdAt: isIsoTimestamp,
  updatedAt: isIsoTimestamp
});

const isStoredSession = isExactObject<StoredSession>({
  id: isString,
  userId: isString,
  tokenDigest: isString,
  deviceId: isString,
  platform: isOneOf("WEB"),
  deviceName: isString,
  createdAt: isIsoTimestamp,
  lastSeenAt: isIsoTimestamp,
  expiresAt: isIsoTimestamp,
  revokedAt: isNullable(isIsoTimestamp),
  revocationReason: isNullable(
    isOneOf(
      "LOGOUT",
      "ROTATED",
      "ACCOUNT_DISABLED",
      "ROLE_CHANGED",
      "PASSWORD_RESET",
      "PASSWORD_CHANGED"
    )
  )
});

const isStoredTicket = isExactObject<StoredCredentialTicket>({
  id: isString,
  userId: isString,
  purpose: isOneOf("ACTIVATION", "PASSWORD_RESET"),
  ticketDigest: isString,
  createdAt: isIsoTimestamp,
  expiresAt: isIsoTimestamp,
  consumedAt: isNullable(isIsoTimestamp)
});

const isStoredLoginAttempt = isExactObject<StoredLoginAttempt>({
  usernameDigest: isString,
  sourceDigest: isString,
  failedAt: isIsoTimestamp
});

const isStoredAuditEvent = isExactObject<StoredSecurityAuditEvent>({
  id: isString,
  event: isOneOf(
    "BOOTSTRAP_ADMIN",
    "USER_CREATED",
    "ACTIVATION_REISSUED",
    "USER_ACTIVATED",
    "LOGIN_SUCCEEDED",
    "LOGIN_FAILED",
    "LOGIN_RATE_LIMITED",
    "SESSION_REFRESHED",
    "SESSION_LOGGED_OUT",
    "USER_DISABLED",
    "USER_ENABLED",
    "USER_ROLE_CHANGED",
    "PASSWORD_CHANGED",
    "PASSWORD_RESET_ISSUED",
    "PASSWORD_RESET_COMPLETED",
    "AUTHORIZATION_DENIED"
  ),
  result: isOneOf("SUCCEEDED", "DENIED"),
  actorId: isNullable(isString),
  targetId: isNullable(isString),
  projectId: isNullable(isString),
  sourceDigest: isNullable(isString),
  occurredAt: isIsoTimestamp
});

const isAuthState = isExactObject<AuthState>({
  version: (value) => value === 1,
  users: isArrayOf(isStoredUser),
  sessions: isArrayOf(isStoredSession),
  tickets: isArrayOf(isStoredTicket),
  loginAttempts: isArrayOf(isStoredLoginAttempt),
  auditEvents: isArrayOf(isStoredAuditEvent)
});

export function assertAuthState(value: unknown): asserts value is AuthState {
  if (!isAuthState(value)) {
    throw new Error("Invalid authentication state format");
  }
}
