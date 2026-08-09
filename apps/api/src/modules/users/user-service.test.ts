import { randomUUID } from "node:crypto";

import type { SystemRole } from "@project-online/domain";
import { beforeEach, describe, expect, it } from "vitest";

import type { PasswordHasher } from "../auth/password.js";
import { digestOpaqueSecret, generateOpaqueSecret } from "../auth/secrets.js";
import type {
  AuthState,
  AuthStateStore,
  StoredSession
} from "../../storage/auth-state.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import {
  ServiceError,
  UserService,
  type AuthenticatedPrincipal
} from "./user-service.js";

const PUBLIC_USER_KEYS = [
  "accountStatus",
  "createdAt",
  "credentialStatus",
  "displayName",
  "id",
  "role",
  "updatedAt",
  "username"
].sort();

const testPasswordHasher: PasswordHasher = {
  async hash(password) {
    return `test-hash$${digestOpaqueSecret(password)}`;
  },
  async verify(password, encoded) {
    return encoded === `test-hash$${digestOpaqueSecret(password)}`;
  }
};

class CountingAuthStateStore implements AuthStateStore {
  updateCalls = 0;

  constructor(private readonly store = new MemoryAuthStateStore()) {}

  read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T> {
    return this.store.read(reader);
  }

  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T> {
    this.updateCalls += 1;
    return this.store.update(mutator);
  }

  resetUpdateCalls(): void {
    this.updateCalls = 0;
  }
}

function makeIdGenerator(): () => string {
  let sequence = 0;
  return () => `test-id-${++sequence}`;
}

function makeSecretGenerator(): () => string {
  const secrets = Array.from({ length: 20 }, () => generateOpaqueSecret());
  return () => {
    const secret = secrets.shift();
    if (secret === undefined) {
      throw new Error("Test secret queue exhausted");
    }
    return secret;
  };
}

function makePassword(): string {
  return `${generateOpaqueSecret()}${generateOpaqueSecret()}`;
}

function makeSession(userId: string): StoredSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    tokenDigest: digestOpaqueSecret(generateOpaqueSecret()),
    deviceId: randomUUID(),
    platform: "WEB",
    deviceName: "Test browser",
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    revokedAt: null,
    revocationReason: null
  };
}

function principal(
  userId: string,
  role: SystemRole = "ADMIN"
): AuthenticatedPrincipal {
  return { userId, sessionId: randomUUID(), role };
}

async function expectServiceError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number
): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ServiceError);
  expect(error).toMatchObject({ code, statusCode });
  expect((error as Error).message).not.toContain("@");
}

describe("UserService", () => {
  let store: CountingAuthStateStore;
  let currentTime: Date;
  let service: UserService;

  beforeEach(() => {
    store = new CountingAuthStateStore();
    currentTime = new Date("2035-04-05T06:07:08.000Z");
    service = new UserService(store, {
      now: () => new Date(currentTime),
      generateId: makeIdGenerator(),
      generateSecret: makeSecretGenerator(),
      digestSecret: digestOpaqueSecret,
      passwordHasher: testPasswordHasher
    });
  });

  async function bootstrapAdmin() {
    return service.bootstrapAdmin({
      username: "  First.Admin  ",
      displayName: "Initial administrator",
      password: makePassword()
    });
  }

  async function createAndActivate(
    admin: AuthenticatedPrincipal,
    role: SystemRole = "USER"
  ) {
    const issued = await service.createUser(admin, {
      username: `member-${randomUUID()}`,
      displayName: "Test member",
      role
    });
    const activated = await service.activate({
      ticket: issued.ticket,
      password: makePassword()
    });
    return activated;
  }

  it("bootstraps one ACTIVE and READY administrator only in an empty store", async () => {
    const user = await bootstrapAdmin();

    expect(user).toEqual({
      id: expect.any(String),
      username: "First.Admin",
      displayName: "Initial administrator",
      role: "ADMIN",
      accountStatus: "ACTIVE",
      credentialStatus: "READY",
      createdAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString()
    });
    expect(store.updateCalls).toBe(1);

    const state = await store.read((snapshot) => snapshot);
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({
      normalizedUsername: "first.admin",
      passwordHash: expect.any(String)
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "BOOTSTRAP_ADMIN",
      result: "SUCCEEDED",
      actorId: null,
      targetId: user.id
    });

    store.resetUpdateCalls();
    await expectServiceError(
      service.bootstrapAdmin({
        username: `second-${randomUUID()}`,
        displayName: "Second administrator",
        password: makePassword()
      }),
      "BOOTSTRAP_NOT_ALLOWED",
      409
    );
    expect(store.updateCalls).toBe(1);
    expect(
      await store.read((snapshot) => snapshot.auditEvents.at(-1)?.result)
    ).toBe("DENIED");
  });

  it("creates a normalized passwordless user and returns one plaintext activation ticket", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    store.resetUpdateCalls();

    const issued = await service.createUser(adminPrincipal, {
      username: "  Mixed.Case  ",
      displayName: "Display name",
      role: "LEADER"
    });

    expect(issued).toEqual({
      user: {
        id: expect.any(String),
        username: "Mixed.Case",
        displayName: "Display name",
        role: "LEADER",
        accountStatus: "ACTIVE",
        credentialStatus: "PENDING_ACTIVATION",
        createdAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString()
      },
      ticket: expect.any(String),
      expiresAt: new Date(
        currentTime.getTime() + 24 * 60 * 60 * 1_000
      ).toISOString()
    });
    expect(store.updateCalls).toBe(1);

    const state = await store.read((snapshot) => snapshot);
    expect(state.users.at(-1)).toMatchObject({
      normalizedUsername: "mixed.case",
      passwordHash: null
    });
    expect(state.tickets.at(-1)).toMatchObject({
      userId: issued.user.id,
      purpose: "ACTIVATION",
      ticketDigest: digestOpaqueSecret(issued.ticket),
      consumedAt: null
    });
    expect(state.tickets.at(-1)?.ticketDigest).not.toBe(issued.ticket);
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "USER_CREATED",
      result: "SUCCEEDED",
      actorId: admin.id,
      targetId: issued.user.id
    });
  });

  it("preserves a valid display name because only usernames are normalized", async () => {
    const admin = await bootstrapAdmin();
    const displayName = "  Padded display name  ";

    const issued = await service.createUser(principal(admin.id), {
      username: `display-${randomUUID()}`,
      displayName,
      role: "USER"
    });

    expect(issued.user.displayName).toBe(displayName);
    expect(
      await store.read(
        (state) =>
          state.users.find(({ id }) => id === issued.user.id)?.displayName
      )
    ).toBe(displayName);
  });

  it("enforces username uniqueness and public input code-point limits", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    await service.createUser(adminPrincipal, {
      username: "Unique.Name",
      displayName: "Original",
      role: "USER"
    });

    await expectServiceError(
      service.createUser(adminPrincipal, {
        username: "  unique.name  ",
        displayName: "Duplicate",
        role: "USER"
      }),
      "USERNAME_CONFLICT",
      409
    );

    await expectServiceError(
      service.createUser(adminPrincipal, {
        username: "ab",
        displayName: "Valid",
        role: "USER"
      }),
      "VALIDATION_ERROR",
      400
    );
    await expectServiceError(
      service.createUser(adminPrincipal, {
        username: "valid-name",
        displayName: "😀".repeat(81),
        role: "USER"
      }),
      "VALIDATION_ERROR",
      400
    );
  });

  it("audits validation rejections without recording rejected input", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const rejectedUsername = randomUUID();

    await expectServiceError(
      service.createUser(adminPrincipal, {
        username: rejectedUsername,
        displayName: "",
        role: "USER"
      }),
      "VALIDATION_ERROR",
      400
    );

    const event = await store.read((state) => state.auditEvents.at(-1));
    expect(event).toMatchObject({
      event: "USER_CREATED",
      result: "DENIED",
      actorId: admin.id,
      targetId: null,
      sourceDigest: null
    });
    expect(JSON.stringify(event)).not.toContain(rejectedUsername);
  });

  it("activates once, hashes the submitted password, and consumes the ticket atomically", async () => {
    const admin = await bootstrapAdmin();
    const issued = await service.createUser(principal(admin.id), {
      username: `activate-${randomUUID()}`,
      displayName: "Activation target",
      role: "USER"
    });
    const password = makePassword();
    store.resetUpdateCalls();

    const activated = await service.activate({
      ticket: issued.ticket,
      password
    });

    expect(activated.credentialStatus).toBe("READY");
    expect(store.updateCalls).toBe(1);
    const state = await store.read((snapshot) => snapshot);
    expect(state.users.find(({ id }) => id === issued.user.id)).toMatchObject({
      credentialStatus: "READY",
      passwordHash: await testPasswordHasher.hash(password),
      updatedAt: currentTime.toISOString()
    });
    expect(
      state.tickets.find(
        ({ ticketDigest }) => ticketDigest === digestOpaqueSecret(issued.ticket)
      )
    ).toMatchObject({ consumedAt: currentTime.toISOString() });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "USER_ACTIVATED",
      result: "SUCCEEDED",
      actorId: null,
      targetId: issued.user.id
    });

    await expectServiceError(
      service.activate({ ticket: issued.ticket, password: makePassword() }),
      "INVALID_TICKET",
      400
    );
    expect(
      await store.read((snapshot) => snapshot.auditEvents.at(-1)?.result)
    ).toBe("DENIED");
  });

  it("rejects expired activation tickets and invalid target state without disclosure", async () => {
    const admin = await bootstrapAdmin();
    const issued = await service.createUser(principal(admin.id), {
      username: `expired-${randomUUID()}`,
      displayName: "Expired activation",
      role: "USER"
    });
    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1_000 + 1);

    await expectServiceError(
      service.activate({ ticket: issued.ticket, password: makePassword() }),
      "INVALID_TICKET",
      400
    );
    expect(
      await store.read((snapshot) => snapshot.auditEvents.at(-1))
    ).toMatchObject({
      event: "USER_ACTIVATED",
      result: "DENIED",
      targetId: issued.user.id
    });
  });

  it("reissues activation for an active pending user and immediately invalidates old tickets", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const original = await service.createUser(adminPrincipal, {
      username: `reissue-${randomUUID()}`,
      displayName: "Reissue target",
      role: "USER"
    });
    store.resetUpdateCalls();

    const replacement = await service.reissueActivation(
      adminPrincipal,
      original.user.id
    );

    expect(store.updateCalls).toBe(1);
    expect(replacement.ticket).not.toBe(original.ticket);
    const tickets = await store.read((snapshot) =>
      snapshot.tickets.filter(({ userId }) => userId === original.user.id)
    );
    expect(tickets).toHaveLength(2);
    expect(tickets[0]?.consumedAt).toBe(currentTime.toISOString());
    expect(tickets[1]).toMatchObject({
      ticketDigest: digestOpaqueSecret(replacement.ticket),
      consumedAt: null
    });

    await expectServiceError(
      service.activate({ ticket: original.ticket, password: makePassword() }),
      "INVALID_TICKET",
      400
    );
    await expect(
      service.activate({ ticket: replacement.ticket, password: makePassword() })
    ).resolves.toMatchObject({ credentialStatus: "READY" });
    await expectServiceError(
      service.reissueActivation(adminPrincipal, original.user.id),
      "INVALID_ACCOUNT_STATE",
      409
    );
  });

  it("disables a user and revokes every live session in one update", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const user = await createAndActivate(adminPrincipal);
    await store.update((state) => {
      state.sessions.push(makeSession(user.id), makeSession(user.id));
    });
    store.resetUpdateCalls();

    const disabled = await service.disableUser(adminPrincipal, user.id);

    expect(disabled.accountStatus).toBe("DISABLED");
    expect(disabled.credentialStatus).toBe("READY");
    expect(store.updateCalls).toBe(1);
    const state = await store.read((snapshot) => snapshot);
    expect(
      state.sessions
        .filter(({ userId }) => userId === user.id)
        .every(
          ({ revokedAt, revocationReason }) =>
            revokedAt === currentTime.toISOString() &&
            revocationReason === "ACCOUNT_DISABLED"
        )
    ).toBe(true);
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "USER_DISABLED",
      result: "SUCCEEDED",
      actorId: admin.id,
      targetId: user.id
    });
  });

  it("enables an account without changing RESET_REQUIRED credentials", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const user = await createAndActivate(adminPrincipal);
    await service.issuePasswordReset(adminPrincipal, user.id);
    await service.disableUser(adminPrincipal, user.id);
    store.resetUpdateCalls();

    const enabled = await service.enableUser(adminPrincipal, user.id);

    expect(enabled).toMatchObject({
      accountStatus: "ACTIVE",
      credentialStatus: "RESET_REQUIRED"
    });
    expect(store.updateCalls).toBe(1);
  });

  it("issues a 30-minute reset ticket, revokes sessions, and completes the reset once", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const user = await createAndActivate(adminPrincipal);
    await store.update((state) => {
      state.sessions.push(makeSession(user.id));
    });
    store.resetUpdateCalls();

    const reset = await service.issuePasswordReset(adminPrincipal, user.id);

    expect(reset.user.credentialStatus).toBe("RESET_REQUIRED");
    expect(reset.expiresAt).toBe(
      new Date(currentTime.getTime() + 30 * 60 * 1_000).toISOString()
    );
    expect(store.updateCalls).toBe(1);
    let state = await store.read((snapshot) => snapshot);
    expect(
      state.sessions.find(({ userId }) => userId === user.id)
    ).toMatchObject({
      revokedAt: currentTime.toISOString(),
      revocationReason: "PASSWORD_RESET"
    });
    expect(state.tickets.at(-1)).toMatchObject({
      purpose: "PASSWORD_RESET",
      ticketDigest: digestOpaqueSecret(reset.ticket),
      consumedAt: null
    });

    const password = makePassword();
    store.resetUpdateCalls();
    const completed = await service.completePasswordReset({
      ticket: reset.ticket,
      password
    });
    expect(completed.credentialStatus).toBe("READY");
    expect(store.updateCalls).toBe(1);
    state = await store.read((snapshot) => snapshot);
    expect(state.users.find(({ id }) => id === user.id)).toMatchObject({
      passwordHash: await testPasswordHasher.hash(password),
      credentialStatus: "READY"
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "PASSWORD_RESET_COMPLETED",
      result: "SUCCEEDED",
      actorId: null,
      targetId: user.id
    });

    await expectServiceError(
      service.completePasswordReset({
        ticket: reset.ticket,
        password: makePassword()
      }),
      "INVALID_TICKET",
      400
    );
  });

  it("rejects expired reset tickets with the same public error", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const user = await createAndActivate(adminPrincipal);
    const reset = await service.issuePasswordReset(adminPrincipal, user.id);
    currentTime = new Date(currentTime.getTime() + 30 * 60 * 1_000 + 1);

    await expectServiceError(
      service.completePasswordReset({
        ticket: reset.ticket,
        password: makePassword()
      }),
      "INVALID_TICKET",
      400
    );
  });

  it("reloads the actor and denies user management to non-admin or stale principals", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const member = await createAndActivate(adminPrincipal, "USER");
    const forgedPrincipal = principal(member.id, "ADMIN");

    await expectServiceError(
      service.listUsers(forgedPrincipal),
      "FORBIDDEN",
      403
    );
    await expectServiceError(
      service.createUser(forgedPrincipal, {
        username: `denied-${randomUUID()}`,
        displayName: "Denied target",
        role: "USER"
      }),
      "FORBIDDEN",
      403
    );
    await expectServiceError(
      service.disableUser(principal(randomUUID()), member.id),
      "FORBIDDEN",
      403
    );

    const deniedEvents = await store.read((state) =>
      state.auditEvents.filter(({ result }) => result === "DENIED")
    );
    expect(deniedEvents).toHaveLength(3);
    expect(deniedEvents.map(({ event }) => event)).toEqual([
      "AUTHORIZATION_DENIED",
      "USER_CREATED",
      "USER_DISABLED"
    ]);
  });

  it("protects the last active and ready administrator from disable or demotion", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);

    await expectServiceError(
      service.disableUser(adminPrincipal, admin.id),
      "LAST_ADMIN_REQUIRED",
      409
    );
    await expectServiceError(
      service.changeRole(adminPrincipal, admin.id, "LEADER"),
      "LAST_ADMIN_REQUIRED",
      409
    );

    const persisted = await store.read((state) => state.users[0]);
    expect(persisted).toMatchObject({
      role: "ADMIN",
      accountStatus: "ACTIVE",
      credentialStatus: "READY"
    });
  });

  it("never allows an administrator to issue a reset ticket for self", async () => {
    const admin = await bootstrapAdmin();

    await expectServiceError(
      service.issuePasswordReset(principal(admin.id), admin.id),
      "SELF_PASSWORD_RESET_NOT_ALLOWED",
      409
    );
    expect(
      await store.read((state) =>
        state.tickets.filter(({ purpose }) => purpose === "PASSWORD_RESET")
      )
    ).toEqual([]);
  });

  it("revokes sessions on role changes and allows last-admin changes when another remains", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const secondAdmin = await createAndActivate(adminPrincipal, "ADMIN");
    await store.update((state) => {
      state.sessions.push(makeSession(admin.id));
    });
    store.resetUpdateCalls();

    const changed = await service.changeRole(
      principal(secondAdmin.id),
      admin.id,
      "USER"
    );

    expect(changed.role).toBe("USER");
    expect(store.updateCalls).toBe(1);
    expect(
      await store.read((state) =>
        state.sessions.find(({ userId }) => userId === admin.id)
      )
    ).toMatchObject({
      revokedAt: currentTime.toISOString(),
      revocationReason: "ROLE_CHANGED"
    });
  });

  it("returns only the exact PublicUser shape from every public-user result", async () => {
    const admin = await bootstrapAdmin();
    const adminPrincipal = principal(admin.id);
    const issued = await service.createUser(adminPrincipal, {
      username: `public-${randomUUID()}`,
      displayName: "Public projection",
      role: "USER"
    });
    const activated = await service.activate({
      ticket: issued.ticket,
      password: makePassword()
    });
    const listed = await service.listUsers(adminPrincipal);

    for (const user of [admin, issued.user, activated, ...listed]) {
      expect(Object.keys(user).sort()).toEqual(PUBLIC_USER_KEYS);
      expect(user).not.toHaveProperty("passwordHash");
      expect(user).not.toHaveProperty("normalizedUsername");
      expect(user).not.toHaveProperty("ticketDigest");
      expect(user).not.toHaveProperty("tokenDigest");
    }
  });

  it("reports missing admin-command targets without including identifiers in messages", async () => {
    const admin = await bootstrapAdmin();
    const missingId = randomUUID();
    const error = await service
      .disableUser(principal(admin.id), missingId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code: "USER_NOT_FOUND", statusCode: 404 });
    expect((error as Error).message).not.toContain(missingId);
  });
});
