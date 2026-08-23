import { randomUUID } from "node:crypto";

import type {
  ProjectAuditEvent,
  ProjectInput,
  ProjectLifecycle,
  ProjectListFilters,
  ProjectMemberRecord,
  ProjectMemberRole,
  ProjectRecord,
  SystemRole
} from "@project-online/domain";
import { describe, expect, it } from "vitest";

import type {
  AuthState,
  StoredSession,
  StoredUser
} from "../../storage/auth-state.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import type {
  CreateMemberRecord,
  CreateProjectAuditEvent,
  CreateProjectRecord,
  ProjectAccessRecord,
  ProjectAuditRecordPage,
  ProjectRecordPage,
  ProjectRepository,
  ProjectTransaction,
  SetProjectLifecycleRecord,
  UpdateMemberRecord,
  UpdateProjectRecord
} from "./project-repository.js";
import { ProjectService } from "./project-service.js";

const currentTime = new Date("2026-08-14T08:00:00.000Z");

const validProjectInput: ProjectInput = {
  name: "虚构城市记忆展",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

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

function storedUser(
  role: SystemRole,
  overrides: Partial<StoredUser> = {}
): StoredUser {
  const id = overrides.id ?? randomUUID();
  const username = overrides.username ?? `fictional-${id.slice(0, 8)}`;
  return {
    id,
    username,
    normalizedUsername: username.toLocaleLowerCase("en-US"),
    displayName: `虚构用户 ${id.slice(0, 4)}`,
    role,
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    passwordHash: null,
    createdAt: currentTime.toISOString(),
    updatedAt: currentTime.toISOString(),
    ...overrides
  };
}

function storedSession(userId: string): StoredSession {
  return {
    id: randomUUID(),
    userId,
    tokenDigest: randomUUID(),
    deviceId: randomUUID(),
    platform: "WEB",
    deviceName: "虚构测试浏览器",
    createdAt: currentTime.toISOString(),
    lastSeenAt: currentTime.toISOString(),
    expiresAt: new Date(currentTime.getTime() + 30 * 60 * 1_000).toISOString(),
    revokedAt: null,
    revocationReason: null
  };
}

class CountingMemoryAuthStateStore extends MemoryAuthStateStore {
  readCalls = 0;

  override read<T>(reader: Parameters<MemoryAuthStateStore["read"]>[0]) {
    this.readCalls += 1;
    return super.read(reader) as Promise<T>;
  }
}

function projectRecord(
  createdBy: string,
  overrides: Partial<ProjectRecord> = {}
): ProjectRecord {
  return {
    id: randomUUID(),
    ...validProjectInput,
    lifecycle: "ACTIVE",
    createdAt: currentTime.toISOString(),
    createdBy,
    updatedAt: currentTime.toISOString(),
    updatedBy: createdBy,
    revision: 1,
    commitSequence: 1,
    archivedAt: null,
    archivedBy: null,
    ...overrides
  };
}

function inputFields(input: ProjectInput): ProjectInput {
  return {
    name: input.name,
    year: input.year,
    type: input.type,
    status: input.status,
    phase: input.phase,
    filingStatus: input.filingStatus,
    plannedCompletionDate: input.plannedCompletionDate,
    actualCompletionDate: input.actualCompletionDate
  };
}

class FakeProjectRepository implements ProjectRepository, ProjectTransaction {
  projects = new Map<string, ProjectRecord>();
  members: ProjectMemberRecord[] = [];
  auditEvents: ProjectAuditEvent[] = [];
  listScopes: Array<"ALL" | { userId: string }> = [];
  ownerLookupProjectIds: readonly string[] = [];
  ownerLookupCalls = 0;
  accessLocks: boolean[] = [];
  nextSequenceCalls = 0;
  failAuditWrites = false;
  private nextSequenceValue = 10;

  async listProjects(
    scope: "ALL" | { userId: string },
    filters: ProjectListFilters
  ): Promise<ProjectRecordPage> {
    this.listScopes.push(scope);
    const visibleProjectIds =
      scope === "ALL"
        ? null
        : new Set(
            this.members
              .filter(({ userId }) => userId === scope.userId)
              .map(({ projectId }) => projectId)
          );
    const visible = [...this.projects.values()].filter(
      ({ id }) => visibleProjectIds === null || visibleProjectIds.has(id)
    );
    const offset = (filters.page - 1) * filters.pageSize;
    return {
      items: visible.slice(offset, offset + filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      total: visible.length
    };
  }

  async listOwnerUserIds(
    projectIds: string[]
  ): Promise<readonly { projectId: string; userId: string }[]> {
    this.ownerLookupCalls += 1;
    this.ownerLookupProjectIds = [...projectIds];
    const selected = new Set(projectIds);
    return this.members
      .filter(
        ({ projectId, memberRole }) =>
          selected.has(projectId) && memberRole === "OWNER"
      )
      .map(({ projectId, userId }) => ({ projectId, userId }));
  }

  async transaction<T>(
    work: (transaction: ProjectTransaction) => Promise<T>
  ): Promise<T> {
    const projects = structuredClone(this.projects);
    const members = structuredClone(this.members);
    const auditEvents = structuredClone(this.auditEvents);
    try {
      return await work(this);
    } catch (error) {
      this.projects = projects;
      this.members = members;
      this.auditEvents = auditEvents;
      throw error;
    }
  }

  async getAccess(
    projectId: string,
    userId: string,
    lock: boolean
  ): Promise<ProjectAccessRecord> {
    this.accessLocks.push(lock);
    const project = this.projects.get(projectId) ?? null;
    const memberRole =
      this.members.find(
        (member) => member.projectId === projectId && member.userId === userId
      )?.memberRole ?? null;
    return { project, memberRole };
  }

  async createProject(input: CreateProjectRecord): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      id: input.id,
      ...inputFields(input),
      lifecycle: "ACTIVE",
      createdAt: input.occurredAt,
      createdBy: input.actorUserId,
      updatedAt: input.occurredAt,
      updatedBy: input.actorUserId,
      revision: 1,
      commitSequence: input.commitSequence,
      archivedAt: null,
      archivedBy: null
    };
    this.projects.set(project.id, project);
    return project;
  }

  async updateProject(
    input: UpdateProjectRecord
  ): Promise<ProjectRecord | null> {
    const current = this.projects.get(input.projectId);
    if (current === undefined) {
      return null;
    }
    const project: ProjectRecord = {
      ...current,
      ...inputFields(input),
      updatedAt: input.occurredAt,
      updatedBy: input.actorUserId,
      revision: current.revision + 1,
      commitSequence: input.commitSequence
    };
    this.projects.set(project.id, project);
    return project;
  }

  async setLifecycle(
    input: SetProjectLifecycleRecord
  ): Promise<ProjectRecord | null> {
    const current = this.projects.get(input.projectId);
    if (current === undefined) {
      return null;
    }
    const archived = input.lifecycle === "ARCHIVED";
    const project: ProjectRecord = {
      ...current,
      lifecycle: input.lifecycle,
      updatedAt: input.occurredAt,
      updatedBy: input.actorUserId,
      revision: current.revision + 1,
      commitSequence: input.commitSequence,
      archivedAt: archived ? input.occurredAt : null,
      archivedBy: archived ? input.actorUserId : null
    };
    this.projects.set(project.id, project);
    return project;
  }

  async touchProject(
    projectId: string,
    actorUserId: string,
    occurredAt: string,
    commitSequence: number
  ): Promise<ProjectRecord | null> {
    const current = this.projects.get(projectId);
    if (current === undefined) {
      return null;
    }
    const project = {
      ...current,
      updatedAt: occurredAt,
      updatedBy: actorUserId,
      revision: current.revision + 1,
      commitSequence
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getMember(
    projectId: string,
    memberId: string,
    _lock: boolean
  ): Promise<ProjectMemberRecord | null> {
    void _lock;
    return (
      this.members.find(
        (member) => member.projectId === projectId && member.id === memberId
      ) ?? null
    );
  }

  async listMembers(projectId: string): Promise<ProjectMemberRecord[]> {
    return this.members.filter((member) => member.projectId === projectId);
  }

  async addMember(input: CreateMemberRecord): Promise<ProjectMemberRecord> {
    const member: ProjectMemberRecord = {
      id: input.id,
      projectId: input.projectId,
      userId: input.userId,
      memberRole: input.memberRole,
      jobTitle: input.jobTitle,
      phone: input.phone,
      remark: input.remark,
      createdAt: input.occurredAt,
      createdBy: input.actorUserId,
      updatedAt: input.occurredAt,
      updatedBy: input.actorUserId
    };
    this.members.push(member);
    return member;
  }

  async updateMember(
    input: UpdateMemberRecord
  ): Promise<ProjectMemberRecord | null> {
    const index = this.members.findIndex(
      (member) =>
        member.projectId === input.projectId && member.id === input.memberId
    );
    const current = this.members[index];
    if (current === undefined) {
      return null;
    }
    const member: ProjectMemberRecord = {
      ...current,
      memberRole: input.memberRole,
      jobTitle: input.jobTitle,
      phone: input.phone,
      remark: input.remark,
      updatedAt: input.occurredAt,
      updatedBy: input.actorUserId
    };
    this.members[index] = member;
    return member;
  }

  async removeMember(
    projectId: string,
    memberId: string
  ): Promise<ProjectMemberRecord | null> {
    const index = this.members.findIndex(
      (member) => member.projectId === projectId && member.id === memberId
    );
    const [removed] = index < 0 ? [] : this.members.splice(index, 1);
    return removed ?? null;
  }

  async countOwners(projectId: string): Promise<number> {
    return this.members.filter(
      (member) =>
        member.projectId === projectId && member.memberRole === "OWNER"
    ).length;
  }

  async writeAudit(event: CreateProjectAuditEvent): Promise<void> {
    if (this.failAuditWrites) {
      throw new Error("fictional audit failure");
    }
    this.auditEvents.push(structuredClone(event));
  }

  async listAudit(
    projectId: string,
    page: number,
    pageSize: number
  ): Promise<ProjectAuditRecordPage> {
    const events = this.auditEvents
      .filter((event) => event.projectId === projectId)
      .sort((left, right) => right.commitSequence - left.commitSequence);
    const offset = (page - 1) * pageSize;
    return {
      items: events.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: events.length
    };
  }

  async nextCommitSequence(): Promise<number> {
    this.nextSequenceCalls += 1;
    this.nextSequenceValue += 1;
    return this.nextSequenceValue;
  }
}

interface ProjectServiceHarness {
  service: ProjectService;
  repository: FakeProjectRepository;
  store: CountingMemoryAuthStateStore;
  principal: AuthenticatedPrincipal;
  principalUser: StoredUser;
  projectId: string;
  validProjectInput: ProjectInput;
}

function createProjectServiceHarness(
  options: {
    principalRole?: SystemRole;
    memberRole?: ProjectMemberRole | null;
    lifecycle?: ProjectLifecycle;
  } = {}
): ProjectServiceHarness {
  const principalRole = options.principalRole ?? "USER";
  const principalUser = storedUser(principalRole);
  const session = storedSession(principalUser.id);
  const state = emptyState();
  state.users.push(principalUser);
  state.sessions.push(session);
  const store = new CountingMemoryAuthStateStore(state);
  const authorization = new AuthorizationService(store, {
    now: () => new Date(currentTime),
    generateId: randomUUID
  });
  const repository = new FakeProjectRepository();
  const project = projectRecord(principalUser.id, {
    lifecycle: options.lifecycle ?? "ACTIVE",
    archivedAt:
      options.lifecycle === "ARCHIVED" ? currentTime.toISOString() : null,
    archivedBy: options.lifecycle === "ARCHIVED" ? principalUser.id : null
  });
  repository.projects.set(project.id, project);
  if (options.memberRole !== null) {
    repository.members.push({
      id: randomUUID(),
      projectId: project.id,
      userId: principalUser.id,
      memberRole: options.memberRole ?? "OWNER",
      jobTitle: "项目负责人",
      phone: "",
      remark: "",
      createdAt: currentTime.toISOString(),
      createdBy: principalUser.id,
      updatedAt: currentTime.toISOString(),
      updatedBy: principalUser.id
    });
  }
  const principal: AuthenticatedPrincipal = {
    userId: principalUser.id,
    sessionId: session.id,
    role: principalRole
  };
  const service = new ProjectService(repository, authorization, store, {
    now: () => new Date(currentTime),
    generateId: randomUUID
  });
  return {
    service,
    repository,
    store,
    principal,
    principalUser,
    projectId: project.id,
    validProjectInput
  };
}

function addOwner(
  harness: ProjectServiceHarness,
  userId: string,
  memberRole: ProjectMemberRole = "OWNER"
): void {
  harness.repository.members.push({
    id: randomUUID(),
    projectId: harness.projectId,
    userId,
    memberRole,
    jobTitle: "虚构负责人",
    phone: "",
    remark: "",
    createdAt: currentTime.toISOString(),
    createdBy: harness.principal.userId,
    updatedAt: currentTime.toISOString(),
    updatedBy: harness.principal.userId
  });
}

describe("ProjectService lists projects", () => {
  it("uses USER scope and resolves all owner summaries in one auth-state read", async () => {
    const harness = createProjectServiceHarness({ principalRole: "USER" });
    const disabledOwner = storedUser("USER", { accountStatus: "DISABLED" });
    await harness.store.update((state) => {
      state.users.push(disabledOwner);
    });
    addOwner(harness, disabledOwner.id);
    addOwner(harness, randomUUID());
    harness.store.readCalls = 0;

    const result = await harness.service.listProjects(harness.principal, {
      page: 1,
      pageSize: 20
    });

    expect(harness.repository.listScopes).toEqual([
      { userId: harness.principal.userId }
    ]);
    expect(harness.repository.ownerLookupCalls).toBe(1);
    expect(harness.repository.ownerLookupProjectIds).toEqual([
      harness.projectId
    ]);
    expect(harness.store.readCalls).toBe(1);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items[0]?.owners).toEqual([
      {
        id: harness.principalUser.id,
        username: harness.principalUser.username,
        displayName: harness.principalUser.displayName,
        accountStatus: "ACTIVE"
      },
      {
        id: disabledOwner.id,
        username: disabledOwner.username,
        displayName: disabledOwner.displayName,
        accountStatus: "DISABLED"
      }
    ]);
  });

  it.each(["LEADER", "ADMIN"] as const)(
    "uses ALL scope for %s",
    async (principalRole) => {
      const harness = createProjectServiceHarness({
        principalRole,
        memberRole: null
      });

      await harness.service.listProjects(harness.principal, {
        page: 2,
        pageSize: 10
      });

      expect(harness.repository.listScopes).toEqual(["ALL"]);
    }
  );
});

describe("ProjectService authorization and details", () => {
  it.each([
    ["OWNER", true, true, true, true],
    ["EDITOR", true, false, false, false],
    ["VIEWER", false, false, false, false]
  ] as const)(
    "maps %s permissions without denial-audit pollution",
    async (
      memberRole,
      canEdit,
      canManageMembers,
      canChangeLifecycle,
      canReadAudit
    ) => {
      const harness = createProjectServiceHarness({ memberRole });

      const result = await harness.service.getProject(
        harness.principal,
        harness.projectId
      );

      expect(result).toEqual({
        project: harness.repository.projects.get(harness.projectId),
        permissions: {
          canEdit,
          canManageMembers,
          canChangeLifecycle,
          canReadAudit
        }
      });
      expect(result).not.toHaveProperty("members");
      expect(
        await harness.store.read((state) => state.auditEvents)
      ).toHaveLength(0);
    }
  );

  it("gives a non-member ADMIN all project permissions", async () => {
    const harness = createProjectServiceHarness({
      principalRole: "ADMIN",
      memberRole: null
    });

    await expect(
      harness.service.getProject(harness.principal, harness.projectId)
    ).resolves.toMatchObject({
      permissions: {
        canEdit: true,
        canManageMembers: true,
        canChangeLifecycle: true,
        canReadAudit: true
      }
    });
  });

  it.each([
    ["OWNER", "USER", "OWNER"],
    ["ADMIN", "ADMIN", null]
  ] as const)(
    "keeps restore available but disables editing and member management for archived %s details",
    async (_actor, principalRole, memberRole) => {
      const harness = createProjectServiceHarness({
        principalRole,
        memberRole,
        lifecycle: "ARCHIVED"
      });

      await expect(
        harness.service.getProject(harness.principal, harness.projectId)
      ).resolves.toMatchObject({
        permissions: {
          canEdit: false,
          canManageMembers: false,
          canChangeLifecycle: true,
          canReadAudit: true
        }
      });
    }
  );

  it("hides an existing project from a non-member USER", async () => {
    const harness = createProjectServiceHarness({ memberRole: null });

    await expect(
      harness.service.getProject(harness.principal, harness.projectId)
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it.each([
    ["ACCOUNT_DISABLED", { accountStatus: "DISABLED" }],
    ["CREDENTIAL_NOT_READY", { credentialStatus: "RESET_REQUIRED" }],
    ["SESSION_INVALID", { forgedSession: true }]
  ] as const)("maps %s to INVALID_SESSION", async (_reason, condition) => {
    const harness = createProjectServiceHarness();
    if ("forgedSession" in condition) {
      harness.principal.sessionId = randomUUID();
    } else {
      await harness.store.update((state) => {
        const user = state.users.find(
          ({ id }) => id === harness.principal.userId
        );
        if (user !== undefined) {
          Object.assign(user, condition);
        }
      });
    }

    await expect(
      harness.service.listProjects(harness.principal, {
        page: 1,
        pageSize: 20
      })
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });
});

describe("ProjectService creates projects", () => {
  it("rejects creation by a non-ADMIN", async () => {
    const harness = createProjectServiceHarness({ principalRole: "LEADER" });

    await expect(
      harness.service.createProject(harness.principal, {
        project: validProjectInput,
        ownerUserId: harness.principal.userId
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harness.repository.projects).toHaveLength(1);
    expect(harness.repository.auditEvents).toHaveLength(0);
  });

  it.each([
    ["missing", null],
    ["disabled", { accountStatus: "DISABLED" as const }],
    [
      "credential not ready",
      { credentialStatus: "PENDING_ACTIVATION" as const }
    ]
  ])("rejects an %s initial owner", async (_label, ownerState) => {
    const harness = createProjectServiceHarness({ principalRole: "ADMIN" });
    const owner = storedUser("USER", ownerState ?? {});
    if (ownerState !== null) {
      await harness.store.update((state) => {
        state.users.push(owner);
      });
    }

    await expect(
      harness.service.createProject(harness.principal, {
        project: validProjectInput,
        ownerUserId: owner.id
      })
    ).rejects.toMatchObject({ code: "USER_NOT_AVAILABLE" });
  });

  it("creates the project, owner, and audit with one timestamp and sequence", async () => {
    const harness = createProjectServiceHarness({ principalRole: "ADMIN" });

    const result = await harness.service.createProject(harness.principal, {
      project: validProjectInput,
      ownerUserId: harness.principal.userId
    });

    expect(result.project).toMatchObject({
      ...validProjectInput,
      lifecycle: "ACTIVE",
      revision: 1,
      createdAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString()
    });
    expect(result.permissions).toEqual({
      canEdit: true,
      canManageMembers: true,
      canChangeLifecycle: true,
      canReadAudit: true
    });
    expect(harness.repository.nextSequenceCalls).toBe(1);
    expect(
      harness.repository.members.filter(
        ({ projectId }) => projectId === result.project.id
      )
    ).toEqual([
      expect.objectContaining({
        userId: harness.principal.userId,
        memberRole: "OWNER",
        jobTitle: "",
        phone: "",
        remark: "",
        createdAt: currentTime.toISOString()
      })
    ]);
    expect(harness.repository.auditEvents).toEqual([
      expect.objectContaining({
        projectId: result.project.id,
        commitSequence: result.project.commitSequence,
        eventType: "PROJECT_CREATED",
        actorUserId: harness.principal.userId,
        targetType: "PROJECT",
        targetId: result.project.id,
        changeSummary: {
          fields: ["name", "year", "type", "status", "phase", "filingStatus"]
        },
        occurredAt: currentTime.toISOString()
      })
    ]);
  });

  it("rolls back project and owner when audit writing fails", async () => {
    const harness = createProjectServiceHarness({ principalRole: "ADMIN" });
    harness.repository.failAuditWrites = true;

    await expect(
      harness.service.createProject(harness.principal, {
        project: validProjectInput,
        ownerUserId: harness.principal.userId
      })
    ).rejects.toThrow("fictional audit failure");
    expect(harness.repository.projects).toHaveLength(1);
    expect(harness.repository.members).toHaveLength(1);
    expect(harness.repository.auditEvents).toHaveLength(0);
  });
});

describe("ProjectService updates projects", () => {
  it.each([
    ["OWNER", true],
    ["EDITOR", true],
    ["VIEWER", false]
  ] as const)(
    "maps %s project edit permission",
    async (memberRole, allowed) => {
      const harness = createProjectServiceHarness({ memberRole });
      const request = harness.service.updateProject(
        harness.principal,
        harness.projectId,
        { ...validProjectInput, name: "虚构城市记忆展（二版）" }
      );
      if (allowed) {
        const result = await request;
        expect(result.project).toMatchObject({ revision: 2 });
        expect(harness.repository.auditEvents).toHaveLength(1);
      } else {
        await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(harness.repository.auditEvents).toHaveLength(0);
      }
    }
  );

  it("audits only actually changed non-sensitive fields", async () => {
    const harness = createProjectServiceHarness();

    const result = await harness.service.updateProject(
      harness.principal,
      harness.projectId,
      {
        ...validProjectInput,
        name: "虚构城市记忆展（二版）",
        year: 2027,
        actualCompletionDate: "2027-01-31"
      }
    );

    expect(harness.repository.accessLocks.at(-1)).toBe(true);
    expect(result.project).toMatchObject({
      revision: 2,
      commitSequence: 11,
      updatedAt: currentTime.toISOString()
    });
    expect(harness.repository.auditEvents).toEqual([
      expect.objectContaining({
        commitSequence: 11,
        eventType: "PROJECT_UPDATED",
        occurredAt: currentTime.toISOString(),
        changeSummary: {
          fields: ["name", "year", "actualCompletionDate"],
          before: {
            name: "虚构城市记忆展",
            year: "2026",
            actualCompletionDate: null
          },
          after: {
            name: "虚构城市记忆展（二版）",
            year: "2027",
            actualCompletionDate: "2027-01-31"
          }
        }
      })
    ]);
  });

  it("returns current details for a no-op without sequence, revision, or audit", async () => {
    const harness = createProjectServiceHarness();

    const result = await harness.service.updateProject(
      harness.principal,
      harness.projectId,
      validProjectInput
    );

    expect(result.project).toEqual(
      harness.repository.projects.get(harness.projectId)
    );
    expect(harness.repository.nextSequenceCalls).toBe(0);
    expect(harness.repository.auditEvents).toHaveLength(0);
  });

  it("rejects updates to archived projects", async () => {
    const harness = createProjectServiceHarness({ lifecycle: "ARCHIVED" });

    await expect(
      harness.service.updateProject(harness.principal, harness.projectId, {
        ...validProjectInput,
        name: "禁止更新的虚构名称"
      })
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_STATE" });
    expect(harness.repository.nextSequenceCalls).toBe(0);
    expect(harness.repository.auditEvents).toHaveLength(0);
  });

  it("rejects invalid project input after authorization", async () => {
    const harness = createProjectServiceHarness();

    await expect(
      harness.service.updateProject(harness.principal, harness.projectId, {
        ...validProjectInput,
        name: ""
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(harness.repository.nextSequenceCalls).toBe(0);
  });
});

describe("ProjectService maps missing project mutations", () => {
  it.each(["updateProject", "archiveProject", "restoreProject"] as const)(
    "returns PROJECT_NOT_FOUND from %s for a valid missing ID",
    async (method) => {
      const harness = createProjectServiceHarness();
      harness.repository.projects.delete(harness.projectId);

      const request =
        method === "updateProject"
          ? harness.service.updateProject(
              harness.principal,
              harness.projectId,
              { ...validProjectInput, name: "虚构缺失项目" }
            )
          : harness.service[method](harness.principal, harness.projectId);

      await expect(request).rejects.toMatchObject({
        code: "PROJECT_NOT_FOUND"
      });
      expect(harness.repository.nextSequenceCalls).toBe(0);
      expect(harness.repository.auditEvents).toHaveLength(0);
    }
  );
});

describe("ProjectService changes project lifecycle", () => {
  it("allows an OWNER to archive with one revision and audit", async () => {
    const harness = createProjectServiceHarness({ memberRole: "OWNER" });

    const result = await harness.service.archiveProject(
      harness.principal,
      harness.projectId
    );

    expect(harness.repository.accessLocks.at(-1)).toBe(true);
    expect(result.project).toMatchObject({
      lifecycle: "ARCHIVED",
      revision: 2,
      archivedAt: currentTime.toISOString(),
      archivedBy: harness.principal.userId
    });
    expect(harness.repository.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "PROJECT_ARCHIVED",
        commitSequence: result.project.commitSequence,
        changeSummary: {
          fields: ["lifecycle"],
          before: { lifecycle: "ACTIVE" },
          after: { lifecycle: "ARCHIVED" }
        }
      })
    ]);
  });

  it("allows a non-member ADMIN to restore with one revision and audit", async () => {
    const harness = createProjectServiceHarness({
      principalRole: "ADMIN",
      memberRole: null,
      lifecycle: "ARCHIVED"
    });

    const result = await harness.service.restoreProject(
      harness.principal,
      harness.projectId
    );

    expect(result.project).toMatchObject({
      lifecycle: "ACTIVE",
      revision: 2,
      archivedAt: null,
      archivedBy: null
    });
    expect(harness.repository.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "PROJECT_RESTORED",
        changeSummary: {
          fields: ["lifecycle"],
          before: { lifecycle: "ARCHIVED" },
          after: { lifecycle: "ACTIVE" }
        }
      })
    ]);
  });

  it.each([
    ["archiveProject", "ACTIVE"],
    ["restoreProject", "ARCHIVED"]
  ] as const)("rejects VIEWER %s", async (method, lifecycle) => {
    const harness = createProjectServiceHarness({
      memberRole: "VIEWER",
      lifecycle
    });

    await expect(
      harness.service[method](harness.principal, harness.projectId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harness.repository.auditEvents).toHaveLength(0);
  });

  it.each([
    ["archiveProject", "ARCHIVED"],
    ["restoreProject", "ACTIVE"]
  ] as const)("rejects %s when already %s", async (method, lifecycle) => {
    const harness = createProjectServiceHarness({ lifecycle });

    await expect(
      harness.service[method](harness.principal, harness.projectId)
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_STATE" });
    expect(harness.repository.nextSequenceCalls).toBe(0);
    expect(harness.repository.auditEvents).toHaveLength(0);
  });
});

describe("ProjectService reads audit events", () => {
  it("requires AUDIT_READ and resolves actors in one auth-state read", async () => {
    const harness = createProjectServiceHarness({ memberRole: "OWNER" });
    const disabledActor = storedUser("USER", { accountStatus: "DISABLED" });
    await harness.store.update((state) => {
      state.users.push(disabledActor);
    });
    const missingActorId = randomUUID();
    harness.repository.auditEvents.push(
      {
        id: randomUUID(),
        projectId: harness.projectId,
        commitSequence: 2,
        eventType: "PROJECT_UPDATED",
        actorUserId: harness.principal.userId,
        targetType: "PROJECT",
        targetId: harness.projectId,
        changeSummary: { fields: ["name"] },
        occurredAt: currentTime.toISOString()
      },
      {
        id: randomUUID(),
        projectId: harness.projectId,
        commitSequence: 3,
        eventType: "PROJECT_ARCHIVED",
        actorUserId: disabledActor.id,
        targetType: "PROJECT",
        targetId: harness.projectId,
        changeSummary: { fields: ["lifecycle"] },
        occurredAt: currentTime.toISOString()
      },
      {
        id: randomUUID(),
        projectId: harness.projectId,
        commitSequence: 4,
        eventType: "PROJECT_RESTORED",
        actorUserId: missingActorId,
        targetType: "PROJECT",
        targetId: harness.projectId,
        changeSummary: { fields: ["lifecycle"] },
        occurredAt: currentTime.toISOString()
      }
    );
    harness.store.readCalls = 0;

    const result = await harness.service.listAuditEvents(
      harness.principal,
      harness.projectId,
      1,
      20
    );

    expect(harness.store.readCalls).toBe(1);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(result.items.map((item: { actor: unknown }) => item.actor)).toEqual([
      null,
      {
        id: disabledActor.id,
        username: disabledActor.username,
        displayName: disabledActor.displayName,
        accountStatus: "DISABLED"
      },
      {
        id: harness.principalUser.id,
        username: harness.principalUser.username,
        displayName: harness.principalUser.displayName,
        accountStatus: "ACTIVE"
      }
    ]);
  });

  it("hides audit existence from a VIEWER", async () => {
    const harness = createProjectServiceHarness({ memberRole: "VIEWER" });

    await expect(
      harness.service.listAuditEvents(
        harness.principal,
        harness.projectId,
        1,
        20
      )
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
