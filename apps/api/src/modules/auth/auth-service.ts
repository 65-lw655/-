import { randomUUID } from "node:crypto";

import { type PasswordHasher, validatePassword } from "./password.js";
import { digestOpaqueSecret, generateOpaqueSecret } from "./secrets.js";
import type {
  AuthState,
  AuthStateStore,
  SecurityAuditEventType,
  StoredSession,
  StoredUser
} from "../../storage/auth-state.js";
import { toPublicUser, type PublicUser } from "../users/public-user.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";

const SESSION_TTL_MS = 30 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 5;

export interface LoginInput {
  username: string;
  password: string;
  sourceAddress: string;
  deviceName: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

export type AuthServiceErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "LOGIN_RATE_LIMITED"
  | "INVALID_SESSION";

const ERROR_DEFINITIONS: Record<
  AuthServiceErrorCode,
  { message: string; statusCode: number }
> = {
  VALIDATION_ERROR: { message: "Invalid request", statusCode: 400 },
  INVALID_CREDENTIALS: {
    message: "Invalid username or password",
    statusCode: 401
  },
  LOGIN_RATE_LIMITED: {
    message: "Too many login attempts",
    statusCode: 429
  },
  INVALID_SESSION: {
    message: "Authentication session is invalid",
    statusCode: 401
  }
};

export class AuthServiceError extends Error {
  readonly code: AuthServiceErrorCode;
  readonly statusCode: number;

  constructor(code: AuthServiceErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "AuthServiceError";
    this.code = code;
    this.statusCode = definition.statusCode;
  }
}

export interface AuthServiceDependencies {
  now: () => Date;
  generateId: () => string;
  generateSecret: () => string;
  digestSecret: (secret: string) => string;
  passwordHasher: PasswordHasher;
}

export type AuthServiceOptions = Pick<
  AuthServiceDependencies,
  "passwordHasher"
> &
  Partial<Omit<AuthServiceDependencies, "passwordHasher">>;

const defaultDependencies: Omit<AuthServiceDependencies, "passwordHasher"> = {
  now: () => new Date(),
  generateId: randomUUID,
  generateSecret: generateOpaqueSecret,
  digestSecret: digestOpaqueSecret
};

type Result<T> =
  { ok: true; value: T } | { ok: false; error: AuthServiceError };

function succeed<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(code: AuthServiceErrorCode): Result<T> {
  return { ok: false, error: new AuthServiceError(code) };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase("en-US");
}

type ReadyUser = StoredUser & { passwordHash: string };

function isReadyUser(user: StoredUser | undefined): user is ReadyUser {
  return (
    user !== undefined &&
    user.accountStatus === "ACTIVE" &&
    user.credentialStatus === "READY" &&
    user.passwordHash !== null
  );
}

export class AuthService {
  private readonly dependencies: AuthServiceDependencies;

  constructor(
    private readonly store: AuthStateStore,
    private readonly dummyPasswordHash: string,
    dependencies: AuthServiceOptions
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async login(input: LoginInput): Promise<IssuedSession> {
    const normalizedUsername = normalizeUsername(input.username);
    const usernameDigest = this.dependencies.digestSecret(normalizedUsername);
    const sourceDigest = this.dependencies.digestSecret(input.sourceAddress);
    const token = this.dependencies.generateSecret();
    const tokenDigest = this.dependencies.digestSecret(token);

    const result = await this.store.update<Result<IssuedSession>>(
      async (state) => {
        const now = this.now();
        const windowStart = Date.parse(now) - LOGIN_WINDOW_MS;
        state.loginAttempts = state.loginAttempts.filter(
          ({ failedAt }) => Date.parse(failedAt) > windowStart
        );

        const user = state.users.find(
          (candidate) => candidate.normalizedUsername === normalizedUsername
        );
        const recentFailures = state.loginAttempts.filter(
          (attempt) =>
            attempt.usernameDigest === usernameDigest &&
            attempt.sourceDigest === sourceDigest
        ).length;
        if (recentFailures >= MAX_LOGIN_FAILURES) {
          this.audit(
            state,
            "LOGIN_RATE_LIMITED",
            "DENIED",
            user?.id ?? null,
            sourceDigest,
            now
          );
          return fail("LOGIN_RATE_LIMITED");
        }

        const passwordHash = user?.passwordHash ?? this.dummyPasswordHash;
        const passwordMatches = await this.dependencies.passwordHasher.verify(
          input.password,
          passwordHash
        );
        if (!isReadyUser(user) || !passwordMatches) {
          state.loginAttempts.push({
            usernameDigest,
            sourceDigest,
            failedAt: now
          });
          this.audit(
            state,
            "LOGIN_FAILED",
            "DENIED",
            user?.id ?? null,
            sourceDigest,
            now
          );
          return fail("INVALID_CREDENTIALS");
        }

        state.loginAttempts = state.loginAttempts.filter(
          (attempt) =>
            attempt.usernameDigest !== usernameDigest ||
            attempt.sourceDigest !== sourceDigest
        );
        const expiresAt = this.expiresAt(now);
        state.sessions.push({
          id: this.dependencies.generateId(),
          userId: user.id,
          tokenDigest,
          deviceId: this.dependencies.generateId(),
          platform: "WEB",
          deviceName: input.deviceName,
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          revokedAt: null,
          revocationReason: null
        });
        this.audit(
          state,
          "LOGIN_SUCCEEDED",
          "SUCCEEDED",
          user.id,
          sourceDigest,
          now
        );
        return succeed({ token, expiresAt, user: toPublicUser(user) });
      }
    );
    return unwrap(result);
  }

  authenticate(token: string): Promise<AuthenticatedPrincipal> {
    const tokenDigest = this.dependencies.digestSecret(token);
    return this.store.read((state) => {
      const now = this.dependencies.now().getTime();
      const session = state.sessions.find(
        (candidate) => candidate.tokenDigest === tokenDigest
      );
      const user =
        session === undefined
          ? undefined
          : state.users.find(({ id }) => id === session.userId);
      if (
        session === undefined ||
        session.revokedAt !== null ||
        Date.parse(session.expiresAt) <= now ||
        !isReadyUser(user)
      ) {
        throw new AuthServiceError("INVALID_SESSION");
      }

      return {
        userId: user.id,
        sessionId: session.id,
        role: user.role
      };
    });
  }

  async refresh(token: string): Promise<IssuedSession> {
    const tokenDigest = this.dependencies.digestSecret(token);
    const replacementToken = this.dependencies.generateSecret();
    const replacementDigest = this.dependencies.digestSecret(replacementToken);

    const result = await this.store.update<Result<IssuedSession>>((state) => {
      const now = this.now();
      const current = this.findCurrentSession(state, tokenDigest, now);
      if (current === null) {
        const identifiable = this.findSessionUser(state, tokenDigest);
        this.audit(
          state,
          "SESSION_REFRESHED",
          "DENIED",
          identifiable?.user?.id ?? null,
          null,
          now
        );
        return fail("INVALID_SESSION");
      }

      const expiresAt = this.expiresAt(now);
      current.session.tokenDigest = replacementDigest;
      current.session.lastSeenAt = now;
      current.session.expiresAt = expiresAt;
      this.audit(
        state,
        "SESSION_REFRESHED",
        "SUCCEEDED",
        current.user.id,
        null,
        now
      );
      return succeed({
        token: replacementToken,
        expiresAt,
        user: toPublicUser(current.user)
      });
    });
    return unwrap(result);
  }

  async logout(token: string): Promise<void> {
    const tokenDigest = this.dependencies.digestSecret(token);
    const result = await this.store.update<Result<void>>((state) => {
      const now = this.now();
      const current = this.findCurrentSession(state, tokenDigest, now);
      if (current === null) {
        const identifiable = this.findSessionUser(state, tokenDigest);
        this.audit(
          state,
          "SESSION_LOGGED_OUT",
          "DENIED",
          identifiable?.user?.id ?? null,
          null,
          now
        );
        return fail("INVALID_SESSION");
      }

      current.session.revokedAt = now;
      current.session.revocationReason = "LOGOUT";
      this.audit(
        state,
        "SESSION_LOGGED_OUT",
        "SUCCEEDED",
        current.user.id,
        null,
        now
      );
      return succeed(undefined);
    });
    return unwrap(result);
  }

  async changePassword(
    token: string,
    currentPassword: string,
    newPassword: string
  ): Promise<IssuedSession> {
    const tokenDigest = this.dependencies.digestSecret(token);
    const replacementToken = this.dependencies.generateSecret();
    const replacementDigest = this.dependencies.digestSecret(replacementToken);

    const result = await this.store.update<Result<IssuedSession>>(
      async (state) => {
        const now = this.now();
        const current = this.findCurrentSession(state, tokenDigest, now);
        if (current === null) {
          const identifiable = this.findSessionUser(state, tokenDigest);
          this.audit(
            state,
            "PASSWORD_CHANGED",
            "DENIED",
            identifiable?.user?.id ?? null,
            null,
            now
          );
          return fail("INVALID_SESSION");
        }
        if (!validatePassword(newPassword).valid) {
          this.audit(
            state,
            "PASSWORD_CHANGED",
            "DENIED",
            current.user.id,
            null,
            now,
            current.user.id
          );
          return fail("VALIDATION_ERROR");
        }

        const passwordMatches = await this.dependencies.passwordHasher.verify(
          currentPassword,
          current.user.passwordHash
        );
        if (!passwordMatches) {
          this.audit(
            state,
            "PASSWORD_CHANGED",
            "DENIED",
            current.user.id,
            null,
            now,
            current.user.id
          );
          return fail("INVALID_CREDENTIALS");
        }

        const passwordHash =
          await this.dependencies.passwordHasher.hash(newPassword);
        const expiresAt = this.expiresAt(now);
        for (const session of state.sessions) {
          if (
            session.userId === current.user.id &&
            session.id !== current.session.id &&
            session.revokedAt === null
          ) {
            session.revokedAt = now;
            session.revocationReason = "PASSWORD_CHANGED";
          }
        }
        current.user.passwordHash = passwordHash;
        current.user.updatedAt = now;
        current.session.tokenDigest = replacementDigest;
        current.session.lastSeenAt = now;
        current.session.expiresAt = expiresAt;
        this.audit(
          state,
          "PASSWORD_CHANGED",
          "SUCCEEDED",
          current.user.id,
          null,
          now,
          current.user.id
        );
        return succeed({
          token: replacementToken,
          expiresAt,
          user: toPublicUser(current.user)
        });
      }
    );
    return unwrap(result);
  }

  private findSessionUser(
    state: Readonly<AuthState>,
    tokenDigest: string
  ): { session: StoredSession; user: StoredUser | undefined } | null {
    const session = state.sessions.find(
      (candidate) => candidate.tokenDigest === tokenDigest
    );
    if (session === undefined) {
      return null;
    }
    return {
      session,
      user: state.users.find(({ id }) => id === session.userId)
    };
  }

  private findCurrentSession(
    state: Readonly<AuthState>,
    tokenDigest: string,
    now: string
  ): { session: StoredSession; user: ReadyUser } | null {
    const identifiable = this.findSessionUser(state, tokenDigest);
    if (
      identifiable === null ||
      identifiable.session.revokedAt !== null ||
      Date.parse(identifiable.session.expiresAt) <= Date.parse(now) ||
      !isReadyUser(identifiable.user)
    ) {
      return null;
    }
    return {
      session: identifiable.session,
      user: identifiable.user
    };
  }

  private audit(
    state: AuthState,
    event: SecurityAuditEventType,
    result: "SUCCEEDED" | "DENIED",
    actorId: string | null,
    sourceDigest: string | null,
    occurredAt: string,
    targetId: string | null = null
  ): void {
    state.auditEvents.push({
      id: this.dependencies.generateId(),
      event,
      result,
      actorId,
      targetId,
      projectId: null,
      sourceDigest,
      occurredAt
    });
  }

  private now(): string {
    return this.dependencies.now().toISOString();
  }

  private expiresAt(now: string): string {
    return new Date(Date.parse(now) + SESSION_TTL_MS).toISOString();
  }
}
