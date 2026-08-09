import { randomUUID } from "node:crypto";

import type {
  AuthorizationAction,
  ProjectMemberRole,
  SystemRole
} from "@project-online/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthState,
  AuthStateStore,
  StoredSession,
  StoredUser
} from "../../storage/auth-state.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import {
  AuthorizationService,
  type ProjectAuthorizationContext
} from "./authorization-service.js";

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

describe("AuthorizationService", () => {
  let currentTime: Date;
  let user: StoredUser;
  let session: StoredSession;
  let principal: AuthenticatedPrincipal;
  let store: CountingAuthStateStore;
  let service: AuthorizationService;

  beforeEach(() => {
    currentTime = new Date("2026-08-09T05:00:00.000Z");
    user = {
      id: randomUUID(),
      username: `member-${randomUUID()}`,
      normalizedUsername: `member-${randomUUID()}`,
      displayName: "Project member",
      role: "USER",
      accountStatus: "ACTIVE",
      credentialStatus: "READY",
      passwordHash: null,
      createdAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString()
    };
    session = {
      id: randomUUID(),
      userId: user.id,
      tokenDigest: randomUUID(),
      deviceId: randomUUID(),
      platform: "WEB",
      deviceName: "Test browser",
      createdAt: currentTime.toISOString(),
      lastSeenAt: currentTime.toISOString(),
      expiresAt: new Date(
        currentTime.getTime() + 30 * 60 * 1_000
      ).toISOString(),
      revokedAt: null,
      revocationReason: null
    };
    const initialState = emptyState();
    initialState.users.push(user);
    initialState.sessions.push(session);
    store = new CountingAuthStateStore(new MemoryAuthStateStore(initialState));
    service = new AuthorizationService(store, {
      now: () => new Date(currentTime),
      generateId: randomUUID
    });
    principal = {
      userId: user.id,
      sessionId: session.id,
      role: "USER"
    };
  });

  function projectContext(
    memberRole: ProjectMemberRole | null,
    projectExists = true
  ): ProjectAuthorizationContext {
    return {
      projectId: randomUUID(),
      projectExists,
      memberRole
    };
  }

  async function authorize(
    action: AuthorizationAction,
    memberRole: ProjectMemberRole | null,
    overrides: Partial<{
      principal: AuthenticatedPrincipal;
      role: SystemRole;
      projectExists: boolean;
    }> = {}
  ) {
    if (overrides.role !== undefined) {
      await store.update((state) => {
        const currentUser = state.users[0];
        if (currentUser !== undefined) {
          currentUser.role = overrides.role as SystemRole;
        }
      });
    }
    return service.authorize(
      overrides.principal ?? principal,
      projectContext(memberRole, overrides.projectExists),
      action
    );
  }

  it("denies a non-member sync write after an administrator role is revoked", async () => {
    const staleAdminPrincipal = { ...principal, role: "ADMIN" as const };

    const decision = await authorize("SYNC_WRITE", null, {
      principal: staleAdminPrincipal
    });

    expect(decision).toEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("denies a non-member leader business write", async () => {
    const decision = await authorize("BUSINESS_UPDATE", null, {
      role: "LEADER"
    });

    expect(decision).toEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("allows a current ordinary project member to read", async () => {
    const decision = await authorize("PROJECT_READ", "VIEWER");

    expect(decision).toEqual({ allowed: true, auditRequired: false });
    expect(await store.read((state) => state.auditEvents)).toHaveLength(0);
  });

  it("applies current account disablement before other denial gates", async () => {
    await store.update((state) => {
      const currentUser = state.users[0];
      const currentSession = state.sessions[0];
      if (currentUser !== undefined && currentSession !== undefined) {
        currentUser.accountStatus = "DISABLED";
        currentSession.revokedAt = currentTime.toISOString();
        currentSession.revocationReason = "ACCOUNT_DISABLED";
      }
    });

    const decision = await authorize("PROJECT_READ", "OWNER", {
      projectExists: false
    });

    expect(decision).toEqual({
      allowed: false,
      reason: "ACCOUNT_DISABLED"
    });
  });

  it("reloads the principal user and session IDs and rejects a forged session", async () => {
    const project = projectContext("OWNER");
    const decision = await service.authorize(
      { ...principal, sessionId: randomUUID(), role: "ADMIN" },
      project,
      "BUSINESS_UPDATE"
    );

    expect(decision).toEqual({ allowed: false, reason: "SESSION_INVALID" });
    expect(await store.read((state) => state.auditEvents.at(-1))).toMatchObject(
      {
        event: "AUTHORIZATION_DENIED",
        result: "DENIED",
        actorId: user.id,
        targetId: null,
        projectId: project.projectId,
        sourceDigest: null,
        occurredAt: currentTime.toISOString()
      }
    );
  });

  it("rechecks session expiry when a queued authorization transaction executes", async () => {
    currentTime = new Date(Date.parse(session.expiresAt) - 1);
    const project = projectContext("OWNER");
    const queue = await store.holdUpdateQueue();

    const pending = service.authorize(principal, project, "PROJECT_READ");
    await vi.waitFor(() => expect(store.updateCalls).toBe(1));
    currentTime = new Date(Date.parse(session.expiresAt));
    queue.release();

    await expect(pending).resolves.toEqual({
      allowed: false,
      reason: "SESSION_INVALID"
    });
    await queue.completed;
    expect(await store.read((state) => state.auditEvents.at(-1))).toMatchObject(
      {
        actorId: user.id,
        projectId: project.projectId,
        occurredAt: currentTime.toISOString()
      }
    );
  });
});
