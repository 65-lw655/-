import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
  AuthState,
  AuthStateStore,
  StoredCredentialTicket,
  StoredLoginAttempt,
  StoredSecurityAuditEvent,
  StoredSession,
  StoredUser
} from "./auth-state.js";

const isPosix = process.platform !== "win32";
type Validator = (value: unknown) => boolean;
type Shape<T extends object> = { [Key in keyof T]-?: Validator };

function createEmptyState(): AuthState {
  return {
    version: 1,
    users: [],
    sessions: [],
    tickets: [],
    loginAttempts: [],
    auditEvents: []
  };
}

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

function assertAuthState(value: unknown): asserts value is AuthState {
  if (!isAuthState(value)) {
    throw new Error("Invalid authentication state format");
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function writeAtomically(
  filePath: string,
  state: AuthState
): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, "wx", isPosix ? 0o600 : undefined);
    if (isPosix) {
      await handle.chmod(0o600);
    }
    await handle.writeFile(JSON.stringify(state), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class FileAuthStateStore implements AuthStateStore {
  private updateQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private state: AuthState
  ) {}

  static async open(filePath: string): Promise<FileAuthStateStore> {
    const directoryPath = dirname(filePath);
    await mkdir(directoryPath, {
      recursive: true,
      ...(isPosix ? { mode: 0o700 } : {})
    });
    if (isPosix) {
      await chmod(directoryPath, 0o700);
    }

    let serialized: string;
    try {
      serialized = await readFile(filePath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const initialState = createEmptyState();
      await writeAtomically(filePath, initialState);
      return new FileAuthStateStore(filePath, initialState);
    }

    if (isPosix) {
      await chmod(filePath, 0o600);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new Error("Invalid authentication state JSON", { cause: error });
    }
    assertAuthState(parsed);
    return new FileAuthStateStore(filePath, structuredClone(parsed));
  }

  async read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T> {
    await this.updateQueue;
    return reader(structuredClone(this.state));
  }

  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T> {
    const operation = this.updateQueue.then(async () => {
      const nextState = structuredClone(this.state);
      const result = await mutator(nextState);
      assertAuthState(nextState);
      await writeAtomically(this.filePath, nextState);
      this.state = nextState;
      return result;
    });

    this.updateQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}
