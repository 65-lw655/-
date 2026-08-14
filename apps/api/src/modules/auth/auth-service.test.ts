import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthState,
  AuthStateStore,
  StoredUser
} from "../../storage/auth-state.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import type { PasswordHasher } from "./password.js";
import { digestOpaqueSecret, generateOpaqueSecret } from "./secrets.js";
import { AuthService, AuthServiceError } from "./auth-service.js";
import { UserService } from "../users/user-service.js";

function makePassword(): string {
  return `${generateOpaqueSecret()}${generateOpaqueSecret()}`;
}

const testPasswordHasher: PasswordHasher = {
  async hash(password) {
    return `test-hash$${digestOpaqueSecret(password)}`;
  },
  async verify(password, encoded) {
    return encoded === `test-hash$${digestOpaqueSecret(password)}`;
  }
};

function makeIdGenerator(): () => string {
  let sequence = 0;
  return () => `test-id-${++sequence}`;
}

function makeSecretGenerator(): () => string {
  const secrets = Array.from({ length: 30 }, () => generateOpaqueSecret());
  return () => {
    const secret = secrets.shift();
    if (secret === undefined) {
      throw new Error("Test secret queue exhausted");
    }
    return secret;
  };
}

function emptyState(): AuthState {
  return {
    version: 1,
    users: [],
    sessions: [],
    tickets: [],
    loginAttempts: [],
    auditEvents: []
  };
}

class CountingAuthStateStore implements AuthStateStore {
  updateCalls = 0;

  constructor(private readonly store: MemoryAuthStateStore) {}

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

  async holdUpdateQueue(): Promise<{
    release: () => void;
    completed: Promise<void>;
  }> {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completed = this.store.update(async () => {
      markStarted();
      await blocked;
    });
    await started;
    return { release, completed };
  }
}

async function expectAuthError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number
): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AuthServiceError);
  expect(error).toMatchObject({ code, statusCode });
}

describe("AuthService login and authenticate", () => {
  let currentTime: Date;
  let password: string;
  let dummyHash: string;
  let user: StoredUser;
  let memoryStore: MemoryAuthStateStore;
  let store: CountingAuthStateStore;
  let service: AuthService;

  beforeEach(async () => {
    currentTime = new Date("2026-08-09T04:00:00.000Z");
    password = makePassword();
    dummyHash = await testPasswordHasher.hash(makePassword());
    user = {
      id: randomUUID(),
      username: "Mixed.Case",
      normalizedUsername: "mixed.case",
      displayName: "Test member",
      role: "USER",
      accountStatus: "ACTIVE",
      credentialStatus: "READY",
      passwordHash: await testPasswordHasher.hash(password),
      createdAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString()
    };
    const initialState = emptyState();
    initialState.users.push(user);
    memoryStore = new MemoryAuthStateStore(initialState);
    store = new CountingAuthStateStore(memoryStore);
    service = new AuthService(store, dummyHash, {
      now: () => new Date(currentTime),
      generateId: makeIdGenerator(),
      generateSecret: makeSecretGenerator(),
      digestSecret: digestOpaqueSecret,
      passwordHasher: testPasswordHasher
    });
  });

  async function login(
    overrides: Partial<{
      username: string;
      password: string;
      sourceAddress: string;
      deviceName: string;
    }> = {}
  ) {
    return service.login({
      username: "  MIXED.case  ",
      password,
      sourceAddress: `source-${randomUUID()}`,
      deviceName: "Test browser",
      ...overrides
    });
  }

  it("creates a 30-minute digest-only session for a valid normalized login", async () => {
    const sourceAddress = `source-${randomUUID()}`;
    const result = await login({ sourceAddress });

    expect(result).toEqual({
      token: expect.any(String),
      expiresAt: new Date(
        currentTime.getTime() + 30 * 60 * 1_000
      ).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        accountStatus: user.accountStatus,
        credentialStatus: user.credentialStatus,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

    const state = await store.read((snapshot) => snapshot);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      userId: user.id,
      tokenDigest: digestOpaqueSecret(result.token),
      deviceName: "Test browser",
      platform: "WEB",
      createdAt: currentTime.toISOString(),
      lastSeenAt: currentTime.toISOString(),
      expiresAt: result.expiresAt,
      revokedAt: null,
      revocationReason: null
    });
    expect(state.sessions[0]?.tokenDigest).not.toBe(result.token);
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "LOGIN_SUCCEEDED",
      result: "SUCCEEDED",
      actorId: user.id,
      sourceDigest: digestOpaqueSecret(sourceAddress)
    });
  });

  it("uses transaction execution time for a queued login session TTL", async () => {
    const queuedAt = new Date(currentTime);
    const queue = await store.holdUpdateQueue();

    const pending = login();
    await vi.waitFor(() => expect(store.updateCalls).toBe(1));
    currentTime = new Date(queuedAt.getTime() + 10 * 60 * 1_000);
    queue.release();
    const result = await pending;
    await queue.completed;

    expect(result.expiresAt).toBe(
      new Date(currentTime.getTime() + 30 * 60 * 1_000).toISOString()
    );
  });

  it("collapses a wrong password to INVALID_CREDENTIALS", async () => {
    await expectAuthError(
      login({ password: makePassword() }),
      "INVALID_CREDENTIALS",
      401
    );

    expect(await store.read((state) => state.sessions)).toHaveLength(0);
  });

  it("verifies unknown users against the injected dummy hash", async () => {
    let usedDummyHash = false;
    const passwordHasher: PasswordHasher = {
      hash: testPasswordHasher.hash,
      async verify(candidate, encoded) {
        usedDummyHash ||= encoded === dummyHash;
        return testPasswordHasher.verify(candidate, encoded);
      }
    };
    service = new AuthService(store, dummyHash, {
      now: () => new Date(currentTime),
      generateId: makeIdGenerator(),
      generateSecret: makeSecretGenerator(),
      digestSecret: digestOpaqueSecret,
      passwordHasher
    });

    await expectAuthError(
      login({ username: `unknown-${randomUUID()}` }),
      "INVALID_CREDENTIALS",
      401
    );

    expect(usedDummyHash).toBe(true);
  });

  it.each([
    ["disabled", "DISABLED", "READY"],
    ["pending activation", "ACTIVE", "PENDING_ACTIVATION"],
    ["reset required", "ACTIVE", "RESET_REQUIRED"]
  ] as const)(
    "uses INVALID_CREDENTIALS for a %s account",
    async (_scenario, accountStatus, credentialStatus) => {
      await store.update((state) => {
        const storedUser = state.users[0];
        if (storedUser !== undefined) {
          storedUser.accountStatus = accountStatus;
          storedUser.credentialStatus = credentialStatus;
        }
      });

      await expectAuthError(login(), "INVALID_CREDENTIALS", 401);
    }
  );

  it("returns LOGIN_RATE_LIMITED on the sixth failure in 15 minutes", async () => {
    const sourceAddress = `source-${randomUUID()}`;
    const wrongPassword = makePassword();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectAuthError(
        login({ sourceAddress, password: wrongPassword }),
        "INVALID_CREDENTIALS",
        401
      );
    }
    await expectAuthError(
      login({ sourceAddress, password: wrongPassword }),
      "LOGIN_RATE_LIMITED",
      429
    );

    const state = await store.read((snapshot) => snapshot);
    expect(state.loginAttempts).toHaveLength(5);
    expect(state.loginAttempts[0]).toMatchObject({
      usernameDigest: digestOpaqueSecret("mixed.case"),
      sourceDigest: digestOpaqueSecret(sourceAddress)
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "LOGIN_RATE_LIMITED",
      result: "DENIED",
      sourceDigest: digestOpaqueSecret(sourceAddress)
    });
  });

  it("clears the matching failure bucket after a successful login", async () => {
    const sourceAddress = `source-${randomUUID()}`;
    const wrongPassword = makePassword();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expectAuthError(
        login({ sourceAddress, password: wrongPassword }),
        "INVALID_CREDENTIALS",
        401
      );
    }
    await login({ sourceAddress });

    expect(await store.read((state) => state.loginAttempts)).toHaveLength(0);
  });

  it("authenticates by token digest and returns the current stored role", async () => {
    const loggedIn = await login();
    await store.update((state) => {
      const storedUser = state.users[0];
      if (storedUser !== undefined) {
        storedUser.role = "LEADER";
      }
    });

    const principal = await service.authenticate(loggedIn.token);

    expect(principal).toEqual({
      userId: user.id,
      sessionId: expect.any(String),
      role: "LEADER"
    });
  });

  it.each([
    ["expired", { expiresAt: "2026-08-09T03:59:59.999Z" }],
    [
      "revoked",
      {
        revokedAt: "2026-08-09T04:00:00.000Z",
        revocationReason: "LOGOUT" as const
      }
    ]
  ])("rejects an %s session", async (_scenario, changes) => {
    const loggedIn = await login();
    await store.update((state) => {
      Object.assign(state.sessions[0] ?? {}, changes);
    });

    await expectAuthError(
      service.authenticate(loggedIn.token),
      "INVALID_SESSION",
      401
    );
  });

  it("rejects an otherwise live session for a non-ready or disabled current user", async () => {
    const loggedIn = await login();
    await store.update((state) => {
      const storedUser = state.users[0];
      if (storedUser !== undefined) {
        storedUser.accountStatus = "DISABLED";
      }
    });

    await expectAuthError(
      service.authenticate(loggedIn.token),
      "INVALID_SESSION",
      401
    );
  });

  it.each(["disable", "change role"] as const)(
    "rejects the old token after an administrator %s command",
    async (command) => {
      const loggedIn = await login();
      const administrator: StoredUser = {
        ...user,
        id: randomUUID(),
        username: `admin-${randomUUID()}`,
        normalizedUsername: `admin-${randomUUID()}`,
        role: "ADMIN"
      };
      await store.update((state) => {
        state.users.push(administrator);
      });
      const userService = new UserService(store, {
        now: () => new Date(currentTime)
      });
      const administratorPrincipal = {
        userId: administrator.id,
        sessionId: randomUUID(),
        role: "ADMIN" as const
      };
      await store.update((state) => {
        state.sessions.push({
          id: administratorPrincipal.sessionId,
          userId: administrator.id,
          tokenDigest: digestOpaqueSecret(generateOpaqueSecret()),
          deviceId: randomUUID(),
          platform: "WEB",
          deviceName: "Administrator browser",
          createdAt: currentTime.toISOString(),
          lastSeenAt: currentTime.toISOString(),
          expiresAt: new Date(
            currentTime.getTime() + 30 * 60 * 1_000
          ).toISOString(),
          revokedAt: null,
          revocationReason: null
        });
      });

      if (command === "disable") {
        await userService.disableUser(administratorPrincipal, user.id);
      } else {
        await userService.changeRole(administratorPrincipal, user.id, "LEADER");
      }

      await expectAuthError(
        service.authenticate(loggedIn.token),
        "INVALID_SESSION",
        401
      );
    }
  );

  it("refreshes once by replacing the digest and immediately rejects the old token", async () => {
    const loggedIn = await login();
    currentTime = new Date(currentTime.getTime() + 5 * 60 * 1_000);
    store.resetUpdateCalls();

    const refreshed = await service.refresh(loggedIn.token);

    expect(refreshed).toMatchObject({
      token: expect.any(String),
      expiresAt: new Date(
        currentTime.getTime() + 30 * 60 * 1_000
      ).toISOString(),
      user: { id: user.id }
    });
    expect(refreshed.token).not.toBe(loggedIn.token);
    expect(store.updateCalls).toBe(1);
    const state = await store.read((snapshot) => snapshot);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      tokenDigest: digestOpaqueSecret(refreshed.token),
      lastSeenAt: currentTime.toISOString(),
      expiresAt: refreshed.expiresAt,
      revokedAt: null,
      revocationReason: null
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "SESSION_REFRESHED",
      result: "SUCCEEDED",
      actorId: user.id,
      sourceDigest: null
    });

    await expectAuthError(
      service.authenticate(loggedIn.token),
      "INVALID_SESSION",
      401
    );
    await expectAuthError(
      service.refresh(loggedIn.token),
      "INVALID_SESSION",
      401
    );
    expect(await service.authenticate(refreshed.token)).toMatchObject({
      userId: user.id
    });
  });

  it("rechecks expiry when a queued refresh transaction executes", async () => {
    const loggedIn = await login();
    currentTime = new Date(Date.parse(loggedIn.expiresAt) - 1);
    const queue = await store.holdUpdateQueue();
    store.resetUpdateCalls();

    const pending = service.refresh(loggedIn.token);
    await vi.waitFor(() => expect(store.updateCalls).toBe(1));
    currentTime = new Date(Date.parse(loggedIn.expiresAt));
    queue.release();

    await expectAuthError(pending, "INVALID_SESSION", 401);
    await queue.completed;
    expect(await store.read((state) => state.sessions[0]?.tokenDigest)).toBe(
      digestOpaqueSecret(loggedIn.token)
    );
  });

  it("rejects refresh for an already expired session", async () => {
    const loggedIn = await login();
    currentTime = new Date(Date.parse(loggedIn.expiresAt));

    await expectAuthError(
      service.refresh(loggedIn.token),
      "INVALID_SESSION",
      401
    );
  });

  it("logs out by revoking only the current session in one transaction", async () => {
    const loggedIn = await login();
    store.resetUpdateCalls();

    await service.logout(loggedIn.token);

    expect(store.updateCalls).toBe(1);
    expect(await store.read((state) => state.sessions[0])).toMatchObject({
      revokedAt: currentTime.toISOString(),
      revocationReason: "LOGOUT"
    });
    expect(await store.read((state) => state.auditEvents.at(-1))).toMatchObject(
      {
        event: "SESSION_LOGGED_OUT",
        result: "SUCCEEDED",
        actorId: user.id
      }
    );
    await expectAuthError(
      service.authenticate(loggedIn.token),
      "INVALID_SESSION",
      401
    );
  });

  it("rejects a wrong current password without changing the user or session", async () => {
    const loggedIn = await login();
    const before = await store.read((state) => ({
      passwordHash: state.users[0]?.passwordHash,
      tokenDigest: state.sessions[0]?.tokenDigest
    }));
    store.resetUpdateCalls();

    await expectAuthError(
      service.changePassword(loggedIn.token, makePassword(), makePassword()),
      "INVALID_CREDENTIALS",
      401
    );

    expect(store.updateCalls).toBe(1);
    expect(
      await store.read((state) => ({
        passwordHash: state.users[0]?.passwordHash,
        tokenDigest: state.sessions[0]?.tokenDigest
      }))
    ).toEqual(before);
    expect(await store.read((state) => state.auditEvents.at(-1))).toMatchObject(
      {
        event: "PASSWORD_CHANGED",
        result: "DENIED",
        actorId: user.id
      }
    );
  });

  it("validates a new password before changing stored credentials", async () => {
    const loggedIn = await login();
    const invalidNewPassword = generateOpaqueSecret().slice(0, 8);

    await expectAuthError(
      service.changePassword(loggedIn.token, password, invalidNewPassword),
      "VALIDATION_ERROR",
      400
    );

    expect(await service.authenticate(loggedIn.token)).toMatchObject({
      userId: user.id
    });
  });

  it("changes the password, revokes other sessions, and rotates the current token", async () => {
    const currentSession = await login({ deviceName: "Current browser" });
    const otherSession = await login({ deviceName: "Other browser" });
    const newPassword = makePassword();
    currentTime = new Date(currentTime.getTime() + 2 * 60 * 1_000);
    store.resetUpdateCalls();

    const changed = await service.changePassword(
      currentSession.token,
      password,
      newPassword
    );

    expect(store.updateCalls).toBe(1);
    expect(changed).toMatchObject({
      token: expect.any(String),
      expiresAt: new Date(
        currentTime.getTime() + 30 * 60 * 1_000
      ).toISOString(),
      user: { id: user.id }
    });
    expect(changed.token).not.toBe(currentSession.token);

    const state = await store.read((snapshot) => snapshot);
    const rotated = state.sessions.find(
      ({ tokenDigest }) => tokenDigest === digestOpaqueSecret(changed.token)
    );
    const revokedOther = state.sessions.find(
      ({ deviceName }) => deviceName === "Other browser"
    );
    expect(rotated).toMatchObject({
      revokedAt: null,
      revocationReason: null,
      lastSeenAt: currentTime.toISOString(),
      expiresAt: changed.expiresAt
    });
    expect(revokedOther).toMatchObject({
      revokedAt: currentTime.toISOString(),
      revocationReason: "PASSWORD_CHANGED"
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      event: "PASSWORD_CHANGED",
      result: "SUCCEEDED",
      actorId: user.id,
      targetId: user.id
    });

    await expectAuthError(
      service.authenticate(currentSession.token),
      "INVALID_SESSION",
      401
    );
    await expectAuthError(
      service.authenticate(otherSession.token),
      "INVALID_SESSION",
      401
    );
    expect(await service.authenticate(changed.token)).toMatchObject({
      userId: user.id
    });
    await expectAuthError(login({ password }), "INVALID_CREDENTIALS", 401);
    expect(await login({ password: newPassword })).toMatchObject({
      user: { id: user.id }
    });
  });
});
