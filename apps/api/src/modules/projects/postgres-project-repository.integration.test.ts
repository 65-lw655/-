import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ProjectAuditEvent,
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
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import { MemberService } from "./member-service.js";
import type {
  CreateMemberRecord,
  CreateProjectAuditEvent,
  CreateProjectRecord
} from "./project-repository.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations"
);

const baseProjectInput: ProjectInput = {
  name: "虚构城市记忆展",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

function fakeListPool(
  plannedCompletionDate: unknown,
  actualCompletionDate: unknown
): Pool {
  let queryCount = 0;
  const projectRow = {
    id: randomUUID(),
    ...baseProjectInput,
    filing_status: baseProjectInput.filingStatus,
    planned_completion_date: plannedCompletionDate,
    actual_completion_date: actualCompletionDate,
    lifecycle: "ACTIVE",
    created_at: "2026-08-14T08:00:00.000Z",
    created_by: randomUUID(),
    updated_at: "2026-08-14T08:00:00.000Z",
    updated_by: randomUUID(),
    revision: 1,
    commit_sequence: "1",
    archived_at: null,
    archived_by: null
  };

  return {
    async query() {
      queryCount += 1;
      return queryCount === 1
        ? { rows: [{ total: "1" }] }
        : { rows: [projectRow] };
    }
  } as unknown as Pool;
}

interface ProjectFixtureOptions {
  actorUserId: string;
  ownerUserId: string;
  occurredAt?: string;
  projectInput?: ProjectInput;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function projectInputFrom(record: ProjectRecord): ProjectInput {
  return {
    name: record.name,
    year: record.year,
    type: record.type,
    status: record.status,
    phase: record.phase,
    filingStatus: record.filingStatus,
    plannedCompletionDate: record.plannedCompletionDate,
    actualCompletionDate: record.actualCompletionDate
  };
}

function serviceUser(username: string, role: SystemRole): StoredUser {
  const id = randomUUID();
  return {
    id,
    username,
    normalizedUsername: username.toLocaleLowerCase("en-US"),
    displayName: `${username}（虚构）`,
    role,
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    passwordHash: null,
    createdAt: "2026-08-22T07:00:00.000Z",
    updatedAt: "2026-08-22T07:00:00.000Z"
  };
}

function serviceSession(userId: string): StoredSession {
  return {
    id: randomUUID(),
    userId,
    tokenDigest: randomUUID(),
    deviceId: randomUUID(),
    platform: "WEB",
    deviceName: "虚构集成测试浏览器",
    createdAt: "2026-08-22T07:00:00.000Z",
    lastSeenAt: "2026-08-22T07:00:00.000Z",
    expiresAt: "2026-08-22T09:00:00.000Z",
    revokedAt: null,
    revocationReason: null
  };
}

async function createProjectFixture(
  repository: PostgresProjectRepository,
  options: ProjectFixtureOptions
): Promise<{
  project: ProjectRecord;
  memberId: string;
  event: ProjectAuditEvent;
}> {
  const occurredAt = options.occurredAt ?? "2026-08-14T08:00:00.000Z";
  const projectId = randomUUID();
  const memberId = randomUUID();
  const eventId = randomUUID();
  const projectInput = options.projectInput ?? baseProjectInput;

  return repository.transaction(async (transaction) => {
    const commitSequence = await transaction.nextCommitSequence();
    const createProject: CreateProjectRecord = {
      ...projectInput,
      id: projectId,
      actorUserId: options.actorUserId,
      occurredAt,
      commitSequence
    };
    const createMember: CreateMemberRecord = {
      id: memberId,
      projectId,
      userId: options.ownerUserId,
      actorUserId: options.actorUserId,
      occurredAt,
      memberRole: "OWNER",
      jobTitle: "项目负责人",
      phone: "13800000000",
      remark: "虚构测试成员"
    };
    const event: CreateProjectAuditEvent = {
      id: eventId,
      projectId,
      commitSequence,
      eventType: "PROJECT_CREATED",
      actorUserId: options.actorUserId,
      targetType: "PROJECT",
      targetId: projectId,
      changeSummary: {
        fields: ["name", "year", "status"],
        after: {
          name: createProject.name,
          year: String(createProject.year),
          status: createProject.status
        }
      },
      occurredAt
    };

    const project = await transaction.createProject(createProject);
    await transaction.addMember(createMember);
    await transaction.writeAudit(event);

    return { project, memberId, event };
  });
}

describe("PostgresProjectRepository project date mapping", () => {
  it("preserves projected YYYY-MM-DD strings without timezone conversion", async () => {
    const repository = new PostgresProjectRepository(
      fakeListPool("2026-08-14", "2026-08-15")
    );

    const page = await repository.listProjects("ALL", {
      page: 1,
      pageSize: 20
    });

    expect(page.items[0]).toMatchObject({
      plannedCompletionDate: "2026-08-14",
      actualCompletionDate: "2026-08-15"
    });
  });

  it("rejects Date objects that bypass the text projection boundary", async () => {
    const repository = new PostgresProjectRepository(
      fakeListPool(new Date(2026, 7, 14), null)
    );

    await expect(
      repository.listProjects("ALL", { page: 1, pageSize: 20 })
    ).rejects.toThrow("PostgreSQL project date mapping failed");
  });
});

describe("PostgresProjectRepository", () => {
  it("creates a project, initial owner, and audit event atomically", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const result = await createProjectFixture(repository, {
        actorUserId: randomUUID(),
        ownerUserId: randomUUID()
      });
      const counts = await pool.query<{
        projects: number;
        members: number;
        events: number;
      }>(`SELECT
            (SELECT count(*)::int FROM projects) AS projects,
            (SELECT count(*)::int FROM project_members) AS members,
            (SELECT count(*)::int FROM project_audit_events) AS events`);

      expect(result.project).toMatchObject({
        revision: 1,
        plannedCompletionDate: "2026-12-31",
        actualCompletionDate: null,
        createdAt: "2026-08-14T08:00:00.000Z",
        updatedAt: "2026-08-14T08:00:00.000Z"
      });
      expect(counts.rows[0]).toEqual({ projects: 1, members: 1, events: 1 });
    });
  });

  it("limits USER scope to joined projects and keeps ALL filters aligned", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const listedUserId = randomUUID();
      const first = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: listedUserId,
        occurredAt: "2026-08-14T08:00:00.000Z",
        projectInput: { ...baseProjectInput, name: "虚构南馆展陈" }
      });
      const second = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: randomUUID(),
        occurredAt: "2026-08-14T09:00:00.000Z",
        projectInput: {
          ...baseProjectInput,
          name: "虚构北馆展陈",
          year: 2027,
          status: "深化中"
        }
      });

      const userPage = await repository.listProjects(
        { userId: listedUserId },
        { page: 1, pageSize: 20 }
      );
      const allPage = await repository.listProjects("ALL", {
        page: 1,
        pageSize: 20
      });
      const filteredPage = await repository.listProjects("ALL", {
        query: "北馆",
        year: 2027,
        status: "深化中",
        lifecycle: "ACTIVE",
        page: 1,
        pageSize: 20
      });
      const injectionPage = await repository.listProjects("ALL", {
        query: "' OR TRUE --",
        page: 1,
        pageSize: 20
      });

      expect(userPage).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(userPage.items.map(({ id }) => id)).toEqual([first.project.id]);
      expect(allPage).toMatchObject({ page: 1, pageSize: 20, total: 2 });
      expect(allPage.items.map(({ id }) => id)).toEqual([
        second.project.id,
        first.project.id
      ]);
      expect(filteredPage).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(filteredPage.items.map(({ id }) => id)).toEqual([
        second.project.id
      ]);
      expect(injectionPage).toMatchObject({ total: 0, items: [] });
    });
  });

  it("lists only OWNER user IDs for a parameterized project batch", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const firstOwnerUserId = randomUUID();
      const secondOwnerUserId = randomUUID();
      const editorUserId = randomUUID();
      const first = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: firstOwnerUserId
      });
      const second = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: secondOwnerUserId
      });
      await repository.transaction((transaction) =>
        transaction.addMember({
          id: randomUUID(),
          projectId: first.project.id,
          userId: editorUserId,
          actorUserId,
          occurredAt: "2026-08-14T10:00:00.000Z",
          memberRole: "EDITOR",
          jobTitle: "虚构编辑",
          phone: "",
          remark: ""
        })
      );

      const owners = await repository.listOwnerUserIds([
        first.project.id,
        second.project.id
      ]);

      expect(owners).toHaveLength(2);
      expect(owners).toEqual(
        expect.arrayContaining([
          { projectId: first.project.id, userId: firstOwnerUserId },
          { projectId: second.project.id, userId: secondOwnerUserId }
        ])
      );
      expect(owners).not.toContainEqual({
        projectId: first.project.id,
        userId: editorUserId
      });
      await expect(repository.listOwnerUserIds([])).resolves.toEqual([]);
    });
  });

  it("increments revisions and commit sequences on successive updates", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: randomUUID()
      });

      const revisionTwo = await repository.transaction(async (transaction) => {
        const commitSequence = await transaction.nextCommitSequence();
        return transaction.updateProject({
          ...projectInputFrom(fixture.project),
          name: "虚构城市记忆展（二版）",
          projectId: fixture.project.id,
          actorUserId,
          occurredAt: "2026-08-14T10:00:00.000Z",
          commitSequence
        });
      });
      const revisionThree = await repository.transaction(
        async (transaction) => {
          const commitSequence = await transaction.nextCommitSequence();
          return transaction.updateProject({
            ...projectInputFrom(fixture.project),
            name: "虚构城市记忆展（三版）",
            projectId: fixture.project.id,
            actorUserId,
            occurredAt: "2026-08-14T11:00:00.000Z",
            commitSequence
          });
        }
      );

      expect(revisionTwo).toMatchObject({ revision: 2 });
      expect(revisionThree).toMatchObject({ revision: 3 });
      expect(revisionTwo).not.toBeNull();
      expect(revisionThree).not.toBeNull();
      expect(revisionTwo!.commitSequence).toBeGreaterThan(
        fixture.project.commitSequence
      );
      expect(revisionThree!.commitSequence).toBeGreaterThan(
        revisionTwo!.commitSequence
      );
    });
  });

  it("rolls back a project update when audit insertion fails", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: randomUUID()
      });

      await expect(
        repository.transaction(async (transaction) => {
          const commitSequence = await transaction.nextCommitSequence();
          await transaction.updateProject({
            ...projectInputFrom(fixture.project),
            name: "不应提交的虚构名称",
            projectId: fixture.project.id,
            actorUserId,
            occurredAt: "2026-08-14T10:00:00.000Z",
            commitSequence
          });
          await transaction.writeAudit({
            ...fixture.event,
            commitSequence,
            eventType: "PROJECT_UPDATED",
            occurredAt: "2026-08-14T10:00:00.000Z"
          });
        })
      ).rejects.toMatchObject({ constraint: "project_audit_events_pkey" });

      const access = await repository.transaction((transaction) =>
        transaction.getAccess(fixture.project.id, actorUserId, false)
      );
      expect(access.project).toEqual(fixture.project);
    });
  });

  it("holds a project row lock until the owning transaction commits", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: actorUserId
      });
      const firstLocked = deferred();
      const releaseFirst = deferred();
      const secondStarted = deferred();

      const firstTransaction = repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, actorUserId, true);
        firstLocked.resolve();
        await releaseFirst.promise;
      });
      await firstLocked.promise;

      const secondTransaction = repository.transaction(async (transaction) => {
        secondStarted.resolve();
        return transaction.getAccess(fixture.project.id, actorUserId, true);
      });
      await secondStarted.promise;

      try {
        const state = await Promise.race([
          secondTransaction.then(() => "acquired" as const),
          new Promise<"blocked">((resolve) => {
            setTimeout(() => resolve("blocked"), 100);
          })
        ]);
        expect(state).toBe("blocked");
      } finally {
        releaseFirst.resolve();
        await Promise.all([firstTransaction, secondTransaction]);
      }
    });
  });

  it("applies the later concurrent project update after the first transaction commits", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const firstActorUserId = randomUUID();
      const secondActorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId: firstActorUserId,
        ownerUserId: firstActorUserId
      });
      const firstLocked = deferred();
      const releaseFirst = deferred();
      const secondStarted = deferred();

      const firstUpdate = repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, firstActorUserId, true);
        firstLocked.resolve();
        await releaseFirst.promise;
        const commitSequence = await transaction.nextCommitSequence();
        return transaction.updateProject({
          ...projectInputFrom(fixture.project),
          name: "虚构并发项目（先提交）",
          projectId: fixture.project.id,
          actorUserId: firstActorUserId,
          occurredAt: "2026-08-14T10:00:00.000Z",
          commitSequence
        });
      });
      await firstLocked.promise;

      const secondUpdate = repository.transaction(async (transaction) => {
        secondStarted.resolve();
        await transaction.getAccess(
          fixture.project.id,
          secondActorUserId,
          true
        );
        const commitSequence = await transaction.nextCommitSequence();
        return transaction.updateProject({
          ...projectInputFrom(fixture.project),
          name: "虚构并发项目（后提交）",
          projectId: fixture.project.id,
          actorUserId: secondActorUserId,
          occurredAt: "2026-08-14T11:00:00.000Z",
          commitSequence
        });
      });
      await secondStarted.promise;

      releaseFirst.resolve();
      const [firstResult, secondResult] = await Promise.all([
        firstUpdate,
        secondUpdate
      ]);
      const finalAccess = await repository.transaction((transaction) =>
        transaction.getAccess(fixture.project.id, secondActorUserId, false)
      );

      expect(firstResult).toMatchObject({
        name: "虚构并发项目（先提交）",
        revision: 2,
        updatedBy: firstActorUserId
      });
      expect(secondResult).toMatchObject({
        name: "虚构并发项目（后提交）",
        revision: 3,
        updatedBy: secondActorUserId
      });
      expect(secondResult!.commitSequence).toBeGreaterThan(
        firstResult!.commitSequence
      );
      expect(finalAccess.project).toEqual(secondResult);
    });
  });

  it("holds a target member row lock until the owning transaction commits", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: actorUserId
      });
      const firstLocked = deferred();
      const releaseFirst = deferred();
      const secondStarted = deferred();

      const firstTransaction = repository.transaction(async (transaction) => {
        await transaction.getMember(fixture.project.id, fixture.memberId, true);
        firstLocked.resolve();
        await releaseFirst.promise;
      });
      await firstLocked.promise;

      const secondTransaction = repository.transaction(async (transaction) => {
        secondStarted.resolve();
        return transaction.getMember(
          fixture.project.id,
          fixture.memberId,
          true
        );
      });
      await secondStarted.promise;

      try {
        const state = await Promise.race([
          secondTransaction.then(() => "acquired" as const),
          new Promise<"blocked">((resolve) => {
            setTimeout(() => resolve("blocked"), 100);
          })
        ]);
        expect(state).toBe("blocked");
      } finally {
        releaseFirst.resolve();
        await Promise.all([firstTransaction, secondTransaction]);
      }
    });
  });

  it("serializes concurrent owner demotion and removal through the member service", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const admin = serviceUser("fictional.concurrent.admin", "ADMIN");
      const firstOwner = serviceUser("fictional.concurrent.owner.one", "USER");
      const secondOwner = serviceUser("fictional.concurrent.owner.two", "USER");
      const session = serviceSession(admin.id);
      const state: AuthState = {
        version: 1,
        users: [admin, firstOwner, secondOwner],
        sessions: [session],
        tickets: [],
        loginAttempts: [],
        auditEvents: []
      };
      const store = new MemoryAuthStateStore(state);
      const authorization = new AuthorizationService(store, {
        now: () => new Date("2026-08-22T08:00:00.000Z"),
        generateId: randomUUID
      });
      const service = new MemberService(repository, authorization, store, {
        now: () => new Date("2026-08-22T08:00:00.000Z"),
        generateId: randomUUID
      });
      const principal: AuthenticatedPrincipal = {
        userId: admin.id,
        sessionId: session.id,
        role: "ADMIN"
      };
      const fixture = await createProjectFixture(repository, {
        actorUserId: admin.id,
        ownerUserId: firstOwner.id,
        occurredAt: "2026-08-22T07:00:00.000Z"
      });
      const secondOwnerMemberId = randomUUID();
      await repository.transaction((transaction) =>
        transaction.addMember({
          id: secondOwnerMemberId,
          projectId: fixture.project.id,
          userId: secondOwner.id,
          actorUserId: admin.id,
          occurredAt: "2026-08-22T07:30:00.000Z",
          memberRole: "OWNER",
          jobTitle: "虚构并发负责人",
          phone: "",
          remark: ""
        })
      );
      const baseline = await repository.transaction(async (transaction) => ({
        access: await transaction.getAccess(
          fixture.project.id,
          admin.id,
          false
        ),
        members: await transaction.listMembers(fixture.project.id),
        audit: await transaction.listAudit(fixture.project.id, 1, 20)
      }));
      const firstOwnerMember = baseline.members.find(
        ({ id }) => id === fixture.memberId
      )!;
      expect(
        baseline.members.filter(({ memberRole }) => memberRole === "OWNER")
      ).toHaveLength(2);

      const results = await Promise.allSettled([
        service.updateMember(principal, fixture.project.id, fixture.memberId, {
          memberRole: "EDITOR",
          jobTitle: firstOwnerMember.jobTitle,
          phone: firstOwnerMember.phone,
          remark: firstOwnerMember.remark
        }),
        service.removeMember(principal, fixture.project.id, secondOwnerMemberId)
      ]);

      expect(
        results.filter(({ status }) => status === "fulfilled")
      ).toHaveLength(1);
      const rejection = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );
      expect(rejection?.reason).toMatchObject({
        code: "LAST_OWNER_REQUIRED"
      });

      const finalState = await repository.transaction(async (transaction) => ({
        access: await transaction.getAccess(
          fixture.project.id,
          admin.id,
          false
        ),
        members: await transaction.listMembers(fixture.project.id),
        audit: await transaction.listAudit(fixture.project.id, 1, 20)
      }));
      const finalProject = finalState.access.project!;
      const baselineProject = baseline.access.project!;
      const newMemberAudits = finalState.audit.items.filter(
        ({ eventType }) =>
          eventType === "MEMBER_UPDATED" || eventType === "MEMBER_REMOVED"
      );

      expect(
        finalState.members.filter(({ memberRole }) => memberRole === "OWNER")
      ).toHaveLength(1);
      expect(finalProject.revision).toBe(baselineProject.revision + 1);
      expect(finalProject.commitSequence).toBe(
        baselineProject.commitSequence + 1
      );
      expect(finalState.audit.total).toBe(baseline.audit.total + 1);
      expect(newMemberAudits).toHaveLength(1);
      expect(newMemberAudits[0]?.commitSequence).toBe(
        finalProject.commitSequence
      );
    });
  });

  it("updates and removes members while preserving null missing results", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: actorUserId
      });
      const addedMemberId = randomUUID();
      const addedUserId = randomUUID();

      await repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, actorUserId, true);
        await transaction.addMember({
          id: addedMemberId,
          projectId: fixture.project.id,
          userId: addedUserId,
          actorUserId,
          occurredAt: "2026-08-14T10:00:00.000Z",
          memberRole: "EDITOR",
          jobTitle: "策展执行",
          phone: "",
          remark: "虚构新增成员"
        });
      });

      const result = await repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, actorUserId, true);
        const updated = await transaction.updateMember({
          projectId: fixture.project.id,
          memberId: addedMemberId,
          actorUserId,
          occurredAt: "2026-08-14T11:00:00.000Z",
          memberRole: "VIEWER",
          jobTitle: "资料查阅",
          phone: "",
          remark: "虚构更新成员"
        });
        const owners = await transaction.countOwners(fixture.project.id);
        const members = await transaction.listMembers(fixture.project.id);
        const removed = await transaction.removeMember(
          fixture.project.id,
          addedMemberId
        );
        const missingUpdate = await transaction.updateMember({
          projectId: fixture.project.id,
          memberId: randomUUID(),
          actorUserId,
          occurredAt: "2026-08-14T12:00:00.000Z",
          memberRole: "VIEWER",
          jobTitle: "",
          phone: "",
          remark: ""
        });
        const missingRemove = await transaction.removeMember(
          fixture.project.id,
          randomUUID()
        );
        return {
          updated,
          owners,
          members,
          removed,
          missingUpdate,
          missingRemove
        };
      });

      expect(result.updated).toMatchObject({
        memberRole: "VIEWER",
        jobTitle: "资料查阅"
      });
      expect(result.owners).toBe(1);
      expect(result.members).toHaveLength(2);
      expect(result.removed?.id).toBe(addedMemberId);
      expect(result.missingUpdate).toBeNull();
      expect(result.missingRemove).toBeNull();
    });
  });

  it("changes lifecycle, touches revisions, and paginates audit events", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      const repository = new PostgresProjectRepository(pool);
      const actorUserId = randomUUID();
      const fixture = await createProjectFixture(repository, {
        actorUserId,
        ownerUserId: actorUserId
      });

      const archived = await repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, actorUserId, true);
        const commitSequence = await transaction.nextCommitSequence();
        const project = await transaction.setLifecycle({
          projectId: fixture.project.id,
          lifecycle: "ARCHIVED",
          actorUserId,
          occurredAt: "2026-08-14T10:00:00.000Z",
          commitSequence
        });
        await transaction.writeAudit({
          id: randomUUID(),
          projectId: fixture.project.id,
          commitSequence,
          eventType: "PROJECT_ARCHIVED",
          actorUserId,
          targetType: "PROJECT",
          targetId: fixture.project.id,
          changeSummary: {
            fields: ["lifecycle"],
            before: { lifecycle: "ACTIVE" },
            after: { lifecycle: "ARCHIVED" }
          },
          occurredAt: "2026-08-14T10:00:00.000Z"
        });
        return project;
      });

      const touched = await repository.transaction(async (transaction) => {
        await transaction.getAccess(fixture.project.id, actorUserId, true);
        const commitSequence = await transaction.nextCommitSequence();
        const project = await transaction.touchProject(
          fixture.project.id,
          actorUserId,
          "2026-08-14T11:00:00.000Z",
          commitSequence
        );
        await transaction.writeAudit({
          id: randomUUID(),
          projectId: fixture.project.id,
          commitSequence,
          eventType: "MEMBER_UPDATED",
          actorUserId,
          targetType: "PROJECT_MEMBER",
          targetId: fixture.memberId,
          changeSummary: {
            fields: ["remark"]
          },
          occurredAt: "2026-08-14T11:00:00.000Z"
        });
        return project;
      });
      const auditPage = await repository.transaction((transaction) =>
        transaction.listAudit(fixture.project.id, 1, 2)
      );
      const missing = await repository.transaction(async (transaction) => {
        const projectId = randomUUID();
        const commitSequence = await transaction.nextCommitSequence();
        return {
          access: await transaction.getAccess(projectId, actorUserId, false),
          update: await transaction.updateProject({
            ...baseProjectInput,
            projectId,
            actorUserId,
            occurredAt: "2026-08-14T12:00:00.000Z",
            commitSequence
          }),
          lifecycle: await transaction.setLifecycle({
            projectId,
            lifecycle: "ARCHIVED",
            actorUserId,
            occurredAt: "2026-08-14T12:00:00.000Z",
            commitSequence
          }),
          touch: await transaction.touchProject(
            projectId,
            actorUserId,
            "2026-08-14T12:00:00.000Z",
            commitSequence
          )
        };
      });

      expect(archived).toMatchObject({
        lifecycle: "ARCHIVED",
        revision: 2,
        archivedAt: "2026-08-14T10:00:00.000Z",
        archivedBy: actorUserId
      });
      expect(touched).toMatchObject({
        lifecycle: "ARCHIVED",
        revision: 3,
        updatedAt: "2026-08-14T11:00:00.000Z"
      });
      expect(auditPage).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(auditPage.items.map(({ eventType }) => eventType)).toEqual([
        "MEMBER_UPDATED",
        "PROJECT_ARCHIVED"
      ]);
      expect(missing).toEqual({
        access: { project: null, memberRole: null },
        update: null,
        lifecycle: null,
        touch: null
      });
    });
  });

  it("rejects commit sequences outside the safe JavaScript integer range", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      await pool.query(
        "SELECT setval('project_commit_sequence', $1::bigint, true)",
        [Number.MAX_SAFE_INTEGER.toString()]
      );
      const repository = new PostgresProjectRepository(pool);

      await expect(
        repository.transaction((transaction) =>
          transaction.nextCommitSequence()
        )
      ).rejects.toThrow(RangeError);
    });
  });
});
