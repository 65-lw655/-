import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ProjectInput,
  ProjectMemberRecord,
  ProjectRecord,
  SystemRole
} from "@project-online/domain";
import {
  PROTOCOL_VERSION,
  type ProjectSyncOperation
} from "@project-online/sync";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../database/migrate.js";
import { withTestDatabase } from "../../database/test-database.js";
import type {
  AuthState,
  StoredSession,
  StoredUser
} from "../../storage/auth-state.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import { PostgresProjectRepository } from "../projects/postgres-project-repository.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import { SyncService } from "./sync-service.js";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations"
);

const now = "2026-08-24T08:00:00.000Z";
const later = "2026-08-24T08:05:00.000Z";

const validProjectInput: ProjectInput = {
  name: "虚构拉取项目",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

function storedUser(role: SystemRole, id = randomUUID()): StoredUser {
  const username = `fictional-${id.slice(0, 8)}`;
  return {
    id,
    username,
    normalizedUsername: username.toLocaleLowerCase("en-US"),
    displayName: `虚构用户 ${id.slice(0, 4)}`,
    role,
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    passwordHash: null,
    createdAt: now,
    updatedAt: now
  };
}

function storedSession(userId: string): StoredSession {
  return {
    id: randomUUID(),
    userId,
    tokenDigest: randomUUID(),
    deviceId: randomUUID(),
    platform: "WEB",
    deviceName: "虚构拉取测试设备",
    createdAt: now,
    lastSeenAt: now,
    expiresAt: "2026-08-24T09:00:00.000Z",
    revokedAt: null,
    revocationReason: null
  };
}

function principalFor(
  user: StoredUser,
  session: StoredSession
): AuthenticatedPrincipal {
  return { userId: user.id, sessionId: session.id, role: user.role };
}

function operation(
  project: ProjectRecord,
  overrides: Partial<ProjectSyncOperation> = {}
): ProjectSyncOperation {
  return {
    protocolVersion: PROTOCOL_VERSION,
    operationId: randomUUID(),
    deviceId: randomUUID(),
    clientSequence: 1,
    entityType: "PROJECT",
    entityId: project.id,
    projectId: project.id,
    action: "UPSERT",
    baseRevision: project.revision,
    payload: { ...validProjectInput, name: `${project.name}（客户端修改）` },
    ...overrides
  };
}

async function createProjectFixture(
  repository: PostgresProjectRepository,
  actorUserId: string,
  ownerUserId: string,
  input: ProjectInput = validProjectInput
): Promise<{ project: ProjectRecord; member: ProjectMemberRecord }> {
  return repository.transaction(async (transaction) => {
    const commitSequence = await transaction.nextCommitSequence();
    const project = await transaction.createProject({
      ...input,
      id: randomUUID(),
      actorUserId,
      occurredAt: now,
      commitSequence
    });
    const member = await transaction.addMember({
      id: randomUUID(),
      projectId: project.id,
      userId: ownerUserId,
      memberRole: "OWNER",
      jobTitle: "项目负责人",
      phone: "",
      remark: "虚构拉取测试成员",
      actorUserId,
      occurredAt: now
    });
    await transaction.writeAudit({
      id: randomUUID(),
      projectId: project.id,
      commitSequence,
      eventType: "PROJECT_CREATED",
      actorUserId,
      targetType: "PROJECT",
      targetId: project.id,
      changeSummary: {
        fields: ["name", "year", "type", "status", "phase", "filingStatus"]
      },
      occurredAt: now
    });
    return { project, member };
  });
}

async function createHarness(pool: Pool, users: StoredUser[]) {
  await runMigrations(pool, migrationsDirectory);
  const repository = new PostgresProjectRepository(pool);
  const sessions = users.map(({ id }) => storedSession(id));
  const state: AuthState = {
    version: 1,
    users,
    sessions,
    tickets: [],
    loginAttempts: [],
    auditEvents: []
  };
  const store = new MemoryAuthStateStore(state);
  const authorization = new AuthorizationService(store, {
    now: () => new Date(now),
    generateId: randomUUID
  });
  const service = new SyncService(repository, authorization, {
    now: () => new Date(later),
    generateId: randomUUID
  });
  return {
    repository,
    service,
    principalForUser: (user: StoredUser) =>
      principalFor(
        user,
        sessions.find(({ userId }) => userId === user.id)!
      )
  };
}

async function pushChange(
  service: SyncService,
  principal: AuthenticatedPrincipal,
  project: ProjectRecord,
  overrides: Partial<ProjectSyncOperation> = {}
) {
  const push = operation(project, overrides);
  const response = await service.pushProjects(principal, {
    protocolVersion: PROTOCOL_VERSION,
    deviceId: push.deviceId,
    operations: [push]
  });
  return response.results[0]!;
}

describe("SyncService.pullProjects", () => {
  it("returns authorized project changes in ascending cursor pages", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const principal = principalForUser(owner);
      const first = await createProjectFixture(repository, owner.id, owner.id);
      const second = await createProjectFixture(
        repository,
        owner.id,
        owner.id,
        {
          ...validProjectInput,
          name: "虚构拉取项目（二）"
        }
      );
      const third = await createProjectFixture(repository, owner.id, owner.id, {
        ...validProjectInput,
        name: "虚构拉取项目（三）"
      });
      const firstResult = await pushChange(service, principal, first.project);
      const secondResult = await pushChange(service, principal, second.project);
      const thirdResult = await pushChange(service, principal, third.project, {
        action: "DELETE",
        payload: {}
      });

      const firstPage = await service.pullProjects(principal, {
        after: firstResult.commitSequence! - 1,
        limit: 2
      });
      const secondPage = await service.pullProjects(principal, {
        after: firstPage.nextCursor,
        limit: 2
      });

      expect(firstPage).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        changes: [
          {
            type: "PROJECT",
            entityId: first.project.id,
            projectId: first.project.id,
            revision: firstResult.revision!,
            commitSequence: firstResult.commitSequence!,
            deleted: false,
            project: {
              ...validProjectInput,
              name: "虚构拉取项目（客户端修改）"
            }
          },
          {
            type: "PROJECT",
            entityId: second.project.id,
            projectId: second.project.id,
            revision: secondResult.revision!,
            commitSequence: secondResult.commitSequence!,
            deleted: false,
            project: {
              ...validProjectInput,
              name: "虚构拉取项目（二）（客户端修改）"
            }
          }
        ],
        nextCursor: secondResult.commitSequence!,
        hasMore: true
      });
      expect(secondPage).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        changes: [
          {
            type: "PROJECT",
            entityId: third.project.id,
            projectId: third.project.id,
            revision: thirdResult.revision!,
            commitSequence: thirdResult.commitSequence!,
            deleted: true,
            project: null
          }
        ],
        nextCursor: thirdResult.commitSequence!,
        hasMore: false
      });
    });
  });

  it("rejects invalid pull cursors and limits before reading changes", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { service, principalForUser } = await createHarness(pool, [owner]);
      const principal = principalForUser(owner);

      await expect(
        service.pullProjects(principal, { after: -1, limit: 1 })
      ).rejects.toThrow(TypeError);
      await expect(
        service.pullProjects(principal, { after: 0, limit: 0 })
      ).rejects.toThrow(TypeError);
      await expect(
        service.pullProjects(principal, { after: 0, limit: 501 })
      ).rejects.toThrow(TypeError);
    });
  });

  it("preserves the input cursor when there are no visible changes", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const principal = principalForUser(owner);
      const fixture = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const accepted = await pushChange(service, principal, fixture.project);

      const response = await service.pullProjects(principal, {
        after: accepted.commitSequence!,
        limit: 10
      });

      expect(response).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        changes: [],
        nextCursor: accepted.commitSequence!,
        hasMore: false
      });
    });
  });

  it("does not return project changes after the principal loses read access", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const otherOwner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner, otherOwner]
      );
      const ownerPrincipal = principalForUser(owner);
      const visible = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const revoked = await createProjectFixture(
        repository,
        otherOwner.id,
        owner.id,
        { ...validProjectInput, name: "虚构拉取项目（撤权）" }
      );
      const visibleResult = await pushChange(
        service,
        ownerPrincipal,
        visible.project
      );
      await pushChange(service, ownerPrincipal, revoked.project);
      await repository.transaction((transaction) =>
        transaction.removeMember(revoked.project.id, revoked.member.id)
      );

      const response = await service.pullProjects(ownerPrincipal, {
        after: visibleResult.commitSequence! - 1,
        limit: 10
      });

      expect(response.changes).toHaveLength(1);
      expect(response.changes[0]?.projectId).toBe(visible.project.id);
      expect(response.nextCursor).toBe(visibleResult.commitSequence);
      expect(response.hasMore).toBe(false);
    });
  });
});
