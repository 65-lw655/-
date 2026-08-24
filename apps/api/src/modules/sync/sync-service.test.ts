import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROTOCOL_VERSION,
  type ProjectSyncOperation
} from "@project-online/sync";
import type {
  ProjectInput,
  ProjectRecord,
  SystemRole
} from "@project-online/domain";
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
  name: "虚构同步项目",
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
    deviceName: "虚构同步测试设备",
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
  project: ProjectRecord | { id: string; revision: number },
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
    payload: { ...validProjectInput, name: "虚构同步项目（客户端修改）" },
    ...overrides
  };
}

async function createProjectFixture(
  repository: PostgresProjectRepository,
  actorUserId: string,
  ownerUserId: string,
  input: ProjectInput = validProjectInput
): Promise<ProjectRecord> {
  return repository.transaction(async (transaction) => {
    const commitSequence = await transaction.nextCommitSequence();
    const project = await transaction.createProject({
      ...input,
      id: randomUUID(),
      actorUserId,
      occurredAt: now,
      commitSequence
    });
    await transaction.addMember({
      id: randomUUID(),
      projectId: project.id,
      userId: ownerUserId,
      memberRole: "OWNER",
      jobTitle: "项目负责人",
      phone: "",
      remark: "虚构同步测试成员",
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
    return project;
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

async function syncCounts(pool: Pool) {
  const result = await pool.query<{
    operations: number;
    changes: number;
    audits: number;
  }>(`SELECT
        (SELECT count(*)::int FROM sync_operation_results) AS operations,
        (SELECT count(*)::int FROM project_change_log) AS changes,
        (SELECT count(*)::int FROM project_audit_events) AS audits`);
  return result.rows[0];
}

describe("SyncService.pushProjects", () => {
  it("accepts an authorized project upsert and writes the project, audit, change log, and operation result atomically", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const project = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const push = operation(project);

      const response = await service.pushProjects(principalForUser(owner), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      });

      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        operationId: push.operationId,
        status: "ACCEPTED",
        entityId: project.id,
        revision: project.revision + 1,
        conflict: false,
        serverCommittedAt: later
      });
      expect(response.results[0]?.commitSequence).toBeGreaterThan(
        project.commitSequence
      );

      const access = await repository.transaction((transaction) =>
        transaction.getAccess(project.id, owner.id, false)
      );
      expect(access.project).toMatchObject({
        id: project.id,
        name: "虚构同步项目（客户端修改）",
        revision: project.revision + 1,
        updatedBy: owner.id
      });
      expect(await syncCounts(pool)).toEqual({
        operations: 1,
        changes: 1,
        audits: 2
      });
    });
  });

  it("returns the stored result for a duplicate operation without writing a second mutation", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const project = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const push = operation(project);
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      };

      const first = await service.pushProjects(
        principalForUser(owner),
        request
      );
      const second = await service.pushProjects(
        principalForUser(owner),
        request
      );

      expect(second.results[0]).toEqual(first.results[0]);
      expect(await syncCounts(pool)).toEqual({
        operations: 1,
        changes: 1,
        audits: 2
      });
      const access = await repository.transaction((transaction) =>
        transaction.getAccess(project.id, owner.id, false)
      );
      expect(access.project?.revision).toBe(project.revision + 1);
    });
  });

  it("persists FORBIDDEN without mutating the project when the actor has lost membership", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const outsider = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner, outsider]
      );
      const project = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const push = operation(project);

      const response = await service.pushProjects(principalForUser(outsider), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      });

      expect(response.results).toEqual([
        {
          operationId: push.operationId,
          status: "FORBIDDEN",
          entityId: project.id
        }
      ]);
      expect(await syncCounts(pool)).toEqual({
        operations: 1,
        changes: 0,
        audits: 1
      });
      const access = await repository.transaction((transaction) =>
        transaction.getAccess(project.id, owner.id, false)
      );
      expect(access.project).toEqual(project);
    });
  });

  it("persists VALIDATION_FAILED without mutating an authorized project", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const project = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const push = operation(project, {
        payload: { ...validProjectInput, name: "" }
      });

      const response = await service.pushProjects(principalForUser(owner), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      });

      expect(response.results).toEqual([
        {
          operationId: push.operationId,
          status: "VALIDATION_FAILED",
          entityId: project.id
        }
      ]);
      expect(await syncCounts(pool)).toEqual({
        operations: 1,
        changes: 0,
        audits: 1
      });
    });
  });

  it("persists NOT_FOUND for a missing project", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { service, principalForUser } = await createHarness(pool, [owner]);
      const missingProject = { id: randomUUID(), revision: 1 };
      const push = operation(missingProject);

      const response = await service.pushProjects(principalForUser(owner), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      });

      expect(response.results).toEqual([
        {
          operationId: push.operationId,
          status: "NOT_FOUND",
          entityId: missingProject.id
        }
      ]);
      expect(await syncCounts(pool)).toEqual({
        operations: 1,
        changes: 0,
        audits: 0
      });
    });
  });

  it("accepts a stale baseRevision as a conflict after locking the current project", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const project = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const current = await repository.transaction(async (transaction) => {
        const commitSequence = await transaction.nextCommitSequence();
        return transaction.updateProject({
          ...validProjectInput,
          name: "虚构同步项目（服务器更新）",
          projectId: project.id,
          actorUserId: owner.id,
          occurredAt: "2026-08-24T08:03:00.000Z",
          commitSequence
        });
      });
      const push = operation(project, { baseRevision: project.revision });

      const response = await service.pushProjects(principalForUser(owner), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: push.deviceId,
        operations: [push]
      });

      expect(response.results[0]).toMatchObject({
        operationId: push.operationId,
        status: "ACCEPTED",
        entityId: project.id,
        revision: current!.revision + 1,
        conflict: true
      });
    });
  });

  it("returns independent results when one operation fails and a later one is valid", async () => {
    await withTestDatabase(async (pool) => {
      const owner = storedUser("USER");
      const { repository, service, principalForUser } = await createHarness(
        pool,
        [owner]
      );
      const firstProject = await createProjectFixture(
        repository,
        owner.id,
        owner.id
      );
      const secondProject = await createProjectFixture(
        repository,
        owner.id,
        owner.id,
        {
          ...validProjectInput,
          name: "虚构同步项目（二）"
        }
      );
      const invalid = operation(firstProject, {
        clientSequence: 1,
        payload: { ...validProjectInput, year: 1800 }
      });
      const valid = operation(secondProject, {
        clientSequence: 2,
        deviceId: invalid.deviceId,
        payload: {
          ...validProjectInput,
          name: "虚构同步项目（二，客户端修改）"
        }
      });

      const response = await service.pushProjects(principalForUser(owner), {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: invalid.deviceId,
        operations: [invalid, valid]
      });

      expect(response.results.map(({ status }) => status)).toEqual([
        "VALIDATION_FAILED",
        "ACCEPTED"
      ]);
      const secondAccess = await repository.transaction((transaction) =>
        transaction.getAccess(secondProject.id, owner.id, false)
      );
      expect(secondAccess.project).toMatchObject({
        name: "虚构同步项目（二，客户端修改）",
        revision: secondProject.revision + 1
      });
      expect(await syncCounts(pool)).toEqual({
        operations: 2,
        changes: 1,
        audits: 3
      });
    });
  });
});
