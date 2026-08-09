import { randomUUID } from "node:crypto";

import type { SystemRole } from "@project-online/domain";

import {
  nodePasswordHasher,
  type PasswordHasher,
  validatePassword
} from "../auth/password.js";
import { digestOpaqueSecret, generateOpaqueSecret } from "../auth/secrets.js";
import type {
  AuthState,
  AuthStateStore,
  SecurityAuditEventType,
  StoredUser
} from "../../storage/auth-state.js";
import { toPublicUser, type PublicUser } from "./public-user.js";

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1_000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  role: SystemRole;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: SystemRole;
}

export interface BootstrapAdminInput {
  username: string;
  displayName: string;
  password: string;
}

export interface ActivateInput {
  ticket: string;
  password: string;
}

export interface CompletePasswordResetInput {
  ticket: string;
  password: string;
}

export interface IssuedCredentialTicket {
  user: PublicUser;
  ticket: string;
  expiresAt: string;
}

export type UserServiceErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "USERNAME_CONFLICT"
  | "BOOTSTRAP_NOT_ALLOWED"
  | "INVALID_TICKET"
  | "INVALID_ACCOUNT_STATE"
  | "LAST_ADMIN_REQUIRED"
  | "SELF_PASSWORD_RESET_NOT_ALLOWED";

const ERROR_DEFINITIONS: Record<
  UserServiceErrorCode,
  { message: string; statusCode: number }
> = {
  VALIDATION_ERROR: { message: "Invalid request", statusCode: 400 },
  FORBIDDEN: { message: "Operation is not allowed", statusCode: 403 },
  USER_NOT_FOUND: { message: "User not found", statusCode: 404 },
  USERNAME_CONFLICT: { message: "Username is unavailable", statusCode: 409 },
  BOOTSTRAP_NOT_ALLOWED: {
    message: "Administrator bootstrap is not allowed",
    statusCode: 409
  },
  INVALID_TICKET: { message: "Credential ticket is invalid", statusCode: 400 },
  INVALID_ACCOUNT_STATE: {
    message: "Account state does not allow this operation",
    statusCode: 409
  },
  LAST_ADMIN_REQUIRED: {
    message: "At least one active administrator is required",
    statusCode: 409
  },
  SELF_PASSWORD_RESET_NOT_ALLOWED: {
    message: "Self password reset is not allowed",
    statusCode: 409
  }
};

export class ServiceError extends Error {
  readonly code: UserServiceErrorCode;
  readonly statusCode: number;

  constructor(code: UserServiceErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "ServiceError";
    this.code = code;
    this.statusCode = definition.statusCode;
  }
}

export interface UserServiceDependencies {
  now: () => Date;
  generateId: () => string;
  generateSecret: () => string;
  digestSecret: (secret: string) => string;
  passwordHasher: PasswordHasher;
}

const defaultDependencies: UserServiceDependencies = {
  now: () => new Date(),
  generateId: randomUUID,
  generateSecret: generateOpaqueSecret,
  digestSecret: digestOpaqueSecret,
  passwordHasher: nodePasswordHasher
};

type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

function succeed<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(code: UserServiceErrorCode): Result<T> {
  return { ok: false, error: new ServiceError(code) };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeUserInput(input: { username: string; displayName: string }): {
  username: string;
  normalizedUsername: string;
  displayName: string;
} {
  const username = input.username.trim();
  const { displayName } = input;
  if (
    codePointLength(username) < 3 ||
    codePointLength(username) > 64 ||
    codePointLength(displayName) < 1 ||
    codePointLength(displayName) > 80
  ) {
    throw new ServiceError("VALIDATION_ERROR");
  }
  return {
    username,
    normalizedUsername: username.toLocaleLowerCase("en-US"),
    displayName
  };
}

function assertRole(role: SystemRole): void {
  if (role !== "USER" && role !== "LEADER" && role !== "ADMIN") {
    throw new ServiceError("VALIDATION_ERROR");
  }
}

function assertPassword(password: string): void {
  if (!validatePassword(password).valid) {
    throw new ServiceError("VALIDATION_ERROR");
  }
}

function isEffectiveAdmin(user: StoredUser): boolean {
  return (
    user.role === "ADMIN" &&
    user.accountStatus === "ACTIVE" &&
    user.credentialStatus === "READY"
  );
}

function findActiveAdmin(
  state: AuthState,
  principal: AuthenticatedPrincipal
): StoredUser | undefined {
  const actor = state.users.find(({ id }) => id === principal.userId);
  return actor !== undefined && isEffectiveAdmin(actor) ? actor : undefined;
}

function revokeSessions(
  state: AuthState,
  userId: string,
  revokedAt: string,
  reason: "ACCOUNT_DISABLED" | "ROLE_CHANGED" | "PASSWORD_RESET"
): void {
  for (const session of state.sessions) {
    if (session.userId === userId && session.revokedAt === null) {
      session.revokedAt = revokedAt;
      session.revocationReason = reason;
    }
  }
}

export class UserService {
  private readonly dependencies: UserServiceDependencies;

  constructor(
    private readonly store: AuthStateStore,
    dependencies: Partial<UserServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async bootstrapAdmin(input: BootstrapAdminInput): Promise<PublicUser> {
    let normalized: ReturnType<typeof normalizeUserInput>;
    try {
      normalized = normalizeUserInput(input);
      assertPassword(input.password);
    } catch (error) {
      if (error instanceof ServiceError) {
        return this.rejectCommand("BOOTSTRAP_ADMIN", "VALIDATION_ERROR");
      }
      throw error;
    }
    const passwordHash = await this.dependencies.passwordHasher.hash(
      input.password
    );
    const now = this.now();

    const result = await this.store.update<Result<PublicUser>>((state) => {
      if (state.users.length !== 0) {
        this.audit(state, "BOOTSTRAP_ADMIN", "DENIED", null, null, now);
        return fail("BOOTSTRAP_NOT_ALLOWED");
      }

      const user: StoredUser = {
        id: this.dependencies.generateId(),
        ...normalized,
        role: "ADMIN",
        accountStatus: "ACTIVE",
        credentialStatus: "READY",
        passwordHash,
        createdAt: now,
        updatedAt: now
      };
      state.users.push(user);
      this.audit(state, "BOOTSTRAP_ADMIN", "SUCCEEDED", null, user.id, now);
      return succeed(toPublicUser(user));
    });
    return unwrap(result);
  }

  async createUser(
    principal: AuthenticatedPrincipal,
    input: CreateUserInput
  ): Promise<IssuedCredentialTicket> {
    let normalized: ReturnType<typeof normalizeUserInput>;
    try {
      normalized = normalizeUserInput(input);
      assertRole(input.role);
    } catch (error) {
      if (error instanceof ServiceError) {
        return this.rejectCommand(
          "USER_CREATED",
          "VALIDATION_ERROR",
          principal
        );
      }
      throw error;
    }
    const ticket = this.dependencies.generateSecret();
    const ticketDigest = this.dependencies.digestSecret(ticket);
    const now = this.now();
    const expiresAt = this.expiresAt(now, ACTIVATION_TTL_MS);

    const result = await this.store.update<Result<IssuedCredentialTicket>>(
      (state) => {
        const actor = findActiveAdmin(state, principal);
        if (actor === undefined) {
          this.audit(state, "USER_CREATED", "DENIED", null, null, now);
          return fail("FORBIDDEN");
        }
        if (
          state.users.some(
            ({ normalizedUsername }) =>
              normalizedUsername === normalized.normalizedUsername
          )
        ) {
          this.audit(state, "USER_CREATED", "DENIED", actor.id, null, now);
          return fail("USERNAME_CONFLICT");
        }

        const user: StoredUser = {
          id: this.dependencies.generateId(),
          ...normalized,
          role: input.role,
          accountStatus: "ACTIVE",
          credentialStatus: "PENDING_ACTIVATION",
          passwordHash: null,
          createdAt: now,
          updatedAt: now
        };
        state.users.push(user);
        state.tickets.push({
          id: this.dependencies.generateId(),
          userId: user.id,
          purpose: "ACTIVATION",
          ticketDigest,
          createdAt: now,
          expiresAt,
          consumedAt: null
        });
        this.audit(state, "USER_CREATED", "SUCCEEDED", actor.id, user.id, now);
        return succeed({ user: toPublicUser(user), ticket, expiresAt });
      }
    );
    return unwrap(result);
  }

  async activate(input: ActivateInput): Promise<PublicUser> {
    try {
      assertPassword(input.password);
    } catch (error) {
      if (error instanceof ServiceError) {
        return this.rejectCommand("USER_ACTIVATED", "VALIDATION_ERROR");
      }
      throw error;
    }
    const passwordHash = await this.dependencies.passwordHasher.hash(
      input.password
    );
    return this.completeTicket(
      input.ticket,
      "ACTIVATION",
      "PENDING_ACTIVATION",
      "USER_ACTIVATED",
      passwordHash
    );
  }

  async reissueActivation(
    principal: AuthenticatedPrincipal,
    userId: string
  ): Promise<IssuedCredentialTicket> {
    const ticket = this.dependencies.generateSecret();
    const ticketDigest = this.dependencies.digestSecret(ticket);
    const now = this.now();
    const expiresAt = this.expiresAt(now, ACTIVATION_TTL_MS);

    const result = await this.store.update<Result<IssuedCredentialTicket>>(
      (state) => {
        const actor = findActiveAdmin(state, principal);
        if (actor === undefined) {
          this.audit(state, "ACTIVATION_REISSUED", "DENIED", null, null, now);
          return fail("FORBIDDEN");
        }
        const user = state.users.find(({ id }) => id === userId);
        if (user === undefined) {
          this.audit(
            state,
            "ACTIVATION_REISSUED",
            "DENIED",
            actor.id,
            null,
            now
          );
          return fail("USER_NOT_FOUND");
        }
        if (
          user.accountStatus !== "ACTIVE" ||
          user.credentialStatus !== "PENDING_ACTIVATION"
        ) {
          this.audit(
            state,
            "ACTIVATION_REISSUED",
            "DENIED",
            actor.id,
            user.id,
            now
          );
          return fail("INVALID_ACCOUNT_STATE");
        }

        this.consumeOpenTickets(state, user.id, "ACTIVATION", now);
        state.tickets.push({
          id: this.dependencies.generateId(),
          userId: user.id,
          purpose: "ACTIVATION",
          ticketDigest,
          createdAt: now,
          expiresAt,
          consumedAt: null
        });
        this.audit(
          state,
          "ACTIVATION_REISSUED",
          "SUCCEEDED",
          actor.id,
          user.id,
          now
        );
        return succeed({ user: toPublicUser(user), ticket, expiresAt });
      }
    );
    return unwrap(result);
  }

  disableUser(
    principal: AuthenticatedPrincipal,
    userId: string
  ): Promise<PublicUser> {
    return this.updateUser(
      principal,
      userId,
      "USER_DISABLED",
      (state, user, now) => {
        if (
          isEffectiveAdmin(user) &&
          state.users.filter(isEffectiveAdmin).length === 1
        ) {
          return "LAST_ADMIN_REQUIRED";
        }
        user.accountStatus = "DISABLED";
        user.updatedAt = now;
        revokeSessions(state, user.id, now, "ACCOUNT_DISABLED");
      }
    );
  }

  enableUser(
    principal: AuthenticatedPrincipal,
    userId: string
  ): Promise<PublicUser> {
    return this.updateUser(
      principal,
      userId,
      "USER_ENABLED",
      (_state, user, now) => {
        user.accountStatus = "ACTIVE";
        user.updatedAt = now;
      }
    );
  }

  changeRole(
    principal: AuthenticatedPrincipal,
    userId: string,
    role: SystemRole
  ): Promise<PublicUser> {
    try {
      assertRole(role);
    } catch (error) {
      if (error instanceof ServiceError) {
        return this.rejectCommand(
          "USER_ROLE_CHANGED",
          "VALIDATION_ERROR",
          principal
        );
      }
      throw error;
    }
    return this.updateUser(
      principal,
      userId,
      "USER_ROLE_CHANGED",
      (state, user, now) => {
        if (
          role !== "ADMIN" &&
          isEffectiveAdmin(user) &&
          state.users.filter(isEffectiveAdmin).length === 1
        ) {
          return "LAST_ADMIN_REQUIRED";
        }
        if (user.role !== role) {
          user.role = role;
          user.updatedAt = now;
          revokeSessions(state, user.id, now, "ROLE_CHANGED");
        }
      }
    );
  }

  async issuePasswordReset(
    principal: AuthenticatedPrincipal,
    userId: string
  ): Promise<IssuedCredentialTicket> {
    const ticket = this.dependencies.generateSecret();
    const ticketDigest = this.dependencies.digestSecret(ticket);
    const now = this.now();
    const expiresAt = this.expiresAt(now, PASSWORD_RESET_TTL_MS);

    const result = await this.store.update<Result<IssuedCredentialTicket>>(
      (state) => {
        const actor = findActiveAdmin(state, principal);
        if (actor === undefined) {
          this.audit(state, "PASSWORD_RESET_ISSUED", "DENIED", null, null, now);
          return fail("FORBIDDEN");
        }
        const user = state.users.find(({ id }) => id === userId);
        if (user === undefined) {
          this.audit(
            state,
            "PASSWORD_RESET_ISSUED",
            "DENIED",
            actor.id,
            null,
            now
          );
          return fail("USER_NOT_FOUND");
        }
        if (actor.id === user.id) {
          this.audit(
            state,
            "PASSWORD_RESET_ISSUED",
            "DENIED",
            actor.id,
            user.id,
            now
          );
          return fail("SELF_PASSWORD_RESET_NOT_ALLOWED");
        }
        if (
          user.accountStatus !== "ACTIVE" ||
          user.credentialStatus !== "READY"
        ) {
          this.audit(
            state,
            "PASSWORD_RESET_ISSUED",
            "DENIED",
            actor.id,
            user.id,
            now
          );
          return fail("INVALID_ACCOUNT_STATE");
        }
        if (
          isEffectiveAdmin(user) &&
          state.users.filter(isEffectiveAdmin).length === 1
        ) {
          this.audit(
            state,
            "PASSWORD_RESET_ISSUED",
            "DENIED",
            actor.id,
            user.id,
            now
          );
          return fail("LAST_ADMIN_REQUIRED");
        }

        user.credentialStatus = "RESET_REQUIRED";
        user.updatedAt = now;
        this.consumeOpenTickets(state, user.id, "PASSWORD_RESET", now);
        state.tickets.push({
          id: this.dependencies.generateId(),
          userId: user.id,
          purpose: "PASSWORD_RESET",
          ticketDigest,
          createdAt: now,
          expiresAt,
          consumedAt: null
        });
        revokeSessions(state, user.id, now, "PASSWORD_RESET");
        this.audit(
          state,
          "PASSWORD_RESET_ISSUED",
          "SUCCEEDED",
          actor.id,
          user.id,
          now
        );
        return succeed({ user: toPublicUser(user), ticket, expiresAt });
      }
    );
    return unwrap(result);
  }

  async completePasswordReset(
    input: CompletePasswordResetInput
  ): Promise<PublicUser> {
    try {
      assertPassword(input.password);
    } catch (error) {
      if (error instanceof ServiceError) {
        return this.rejectCommand(
          "PASSWORD_RESET_COMPLETED",
          "VALIDATION_ERROR"
        );
      }
      throw error;
    }
    const passwordHash = await this.dependencies.passwordHasher.hash(
      input.password
    );
    return this.completeTicket(
      input.ticket,
      "PASSWORD_RESET",
      "RESET_REQUIRED",
      "PASSWORD_RESET_COMPLETED",
      passwordHash
    );
  }

  async listUsers(principal: AuthenticatedPrincipal): Promise<PublicUser[]> {
    const now = this.now();
    const result = await this.store.update<Result<PublicUser[]>>((state) => {
      const actor = findActiveAdmin(state, principal);
      if (actor === undefined) {
        this.audit(state, "AUTHORIZATION_DENIED", "DENIED", null, null, now);
        return fail("FORBIDDEN");
      }
      return succeed(state.users.map(toPublicUser));
    });
    return unwrap(result);
  }

  private async completeTicket(
    plaintextTicket: string,
    purpose: "ACTIVATION" | "PASSWORD_RESET",
    expectedCredentialStatus: "PENDING_ACTIVATION" | "RESET_REQUIRED",
    event: "USER_ACTIVATED" | "PASSWORD_RESET_COMPLETED",
    passwordHash: string
  ): Promise<PublicUser> {
    const ticketDigest = this.dependencies.digestSecret(plaintextTicket);
    const now = this.now();
    const result = await this.store.update<Result<PublicUser>>((state) => {
      const ticket = state.tickets.find(
        (candidate) =>
          candidate.purpose === purpose &&
          candidate.ticketDigest === ticketDigest
      );
      const user =
        ticket === undefined
          ? undefined
          : state.users.find(({ id }) => id === ticket.userId);
      const valid =
        ticket !== undefined &&
        ticket.consumedAt === null &&
        Date.parse(ticket.expiresAt) > Date.parse(now) &&
        user !== undefined &&
        user.accountStatus === "ACTIVE" &&
        user.credentialStatus === expectedCredentialStatus;

      if (!valid || ticket === undefined || user === undefined) {
        this.audit(state, event, "DENIED", null, user?.id ?? null, now);
        return fail("INVALID_TICKET");
      }

      ticket.consumedAt = now;
      user.passwordHash = passwordHash;
      user.credentialStatus = "READY";
      user.updatedAt = now;
      this.audit(state, event, "SUCCEEDED", null, user.id, now);
      return succeed(toPublicUser(user));
    });
    return unwrap(result);
  }

  private async rejectCommand(
    event: SecurityAuditEventType,
    code: UserServiceErrorCode,
    principal?: AuthenticatedPrincipal
  ): Promise<never> {
    const now = this.now();
    const result = await this.store.update<Result<never>>((state) => {
      if (principal !== undefined) {
        const actor = findActiveAdmin(state, principal);
        if (actor === undefined) {
          this.audit(state, event, "DENIED", null, null, now);
          return fail("FORBIDDEN");
        }
        this.audit(state, event, "DENIED", actor.id, null, now);
        return fail(code);
      }

      this.audit(state, event, "DENIED", null, null, now);
      return fail(code);
    });
    return unwrap(result);
  }

  private async updateUser(
    principal: AuthenticatedPrincipal,
    userId: string,
    event: "USER_DISABLED" | "USER_ENABLED" | "USER_ROLE_CHANGED",
    mutate: (
      state: AuthState,
      user: StoredUser,
      now: string
    ) => UserServiceErrorCode | void
  ): Promise<PublicUser> {
    const now = this.now();
    const result = await this.store.update<Result<PublicUser>>((state) => {
      const actor = findActiveAdmin(state, principal);
      if (actor === undefined) {
        this.audit(state, event, "DENIED", null, null, now);
        return fail("FORBIDDEN");
      }
      const user = state.users.find(({ id }) => id === userId);
      if (user === undefined) {
        this.audit(state, event, "DENIED", actor.id, null, now);
        return fail("USER_NOT_FOUND");
      }
      const errorCode = mutate(state, user, now);
      if (errorCode !== undefined) {
        this.audit(state, event, "DENIED", actor.id, user.id, now);
        return fail(errorCode);
      }
      this.audit(state, event, "SUCCEEDED", actor.id, user.id, now);
      return succeed(toPublicUser(user));
    });
    return unwrap(result);
  }

  private consumeOpenTickets(
    state: AuthState,
    userId: string,
    purpose: "ACTIVATION" | "PASSWORD_RESET",
    consumedAt: string
  ): void {
    for (const ticket of state.tickets) {
      if (
        ticket.userId === userId &&
        ticket.purpose === purpose &&
        ticket.consumedAt === null
      ) {
        ticket.consumedAt = consumedAt;
      }
    }
  }

  private audit(
    state: AuthState,
    event: SecurityAuditEventType,
    result: "SUCCEEDED" | "DENIED",
    actorId: string | null,
    targetId: string | null,
    occurredAt: string
  ): void {
    state.auditEvents.push({
      id: this.dependencies.generateId(),
      event,
      result,
      actorId,
      targetId,
      projectId: null,
      sourceDigest: null,
      occurredAt
    });
  }

  private now(): string {
    return this.dependencies.now().toISOString();
  }

  private expiresAt(now: string, ttlMs: number): string {
    return new Date(Date.parse(now) + ttlMs).toISOString();
  }
}
