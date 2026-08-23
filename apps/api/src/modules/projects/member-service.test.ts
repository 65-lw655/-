import { randomUUID } from "node:crypto";

import type {
  MemberInput,
  ProjectAuditEvent,
  ProjectLifecycle,
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
import { MemberService } from "./member-service.js";
import type {
  CreateMemberRecord,
  CreateProjectAuditEvent,
  ProjectAccessRecord,
  ProjectAuditRecordPage,
  ProjectRecordPage,
  ProjectRepository,
  ProjectTransaction,
  SetProjectLifecycleRecord,
  UpdateMemberRecord,
  UpdateProjectRecord,
  CreateProjectRecord
} from "./project-repository.js";

const currentTime = "2026-08-21T08:00:00.000Z";

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
  overrides: Partial<StoredUser> & Pick<StoredUser, "username">
): StoredUser {
  const { username, ...rest } = overrides;
  return {
    id: randomUUID(),
    username,
    normalizedUsername: username.toLocaleLowerCase(),
    displayName: `${username}（虚构）`,
    role: "USER",
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    passwordHash: null,
    createdAt: currentTime,
    updatedAt: currentTime,
    ...rest
  };
}

function storedSession(userId: string): StoredSession {
  return {
    id: randomUUID(),
    userId,
    tokenDigest: "fictional-session-digest",
    deviceId: "fictional-device",
    platform: "WEB",
    deviceName: "虚构浏览器",
    createdAt: currentTime,
    lastSeenAt: currentTime,
    expiresAt: "2026-08-22T08:00:00.000Z",
    revokedAt: null,
    revocationReason: null
  };
}

function projectRecord(
  creatorId: string,
  lifecycle: ProjectLifecycle = "ACTIVE"
): ProjectRecord {
  return {
    id: randomUUID(),
    name: "虚构展陈项目",
    year: 2026,
    type: "展陈",
    status: "施工中",
    phase: "实施",
    filingStatus: "已归档",
    plannedCompletionDate: null,
    actualCompletionDate: null,
    lifecycle,
    createdAt: currentTime,
    createdBy: creatorId,
    updatedAt: currentTime,
    updatedBy: creatorId,
    revision: 3,
    commitSequence: 8,
    archivedAt: lifecycle === "ARCHIVED" ? currentTime : null,
    archivedBy: lifecycle === "ARCHIVED" ? creatorId : null
  };
}

function memberRecord(
  projectId: string,
  userId: string,
  memberRole: ProjectMemberRole,
  overrides: Partial<ProjectMemberRecord> = {}
): ProjectMemberRecord {
  return {
    id: randomUUID(),
    projectId,
    userId,
    memberRole,
    jobTitle: "虚构岗位",
    phone: "",
    remark: "",
    createdAt: currentTime,
    createdBy: userId,
    updatedAt: currentTime,
    updatedBy: userId,
    ...overrides
  };
}

class CountingMemoryAuthStateStore extends MemoryAuthStateStore {
  readCalls = 0;

  override read<T>(reader: Parameters<MemoryAuthStateStore["read"]>[0]) {
    this.readCalls += 1;
    return super.read(reader) as Promise<T>;
  }
}

class FakeMemberRepository implements ProjectRepository, ProjectTransaction {
  projects = new Map<string, ProjectRecord>();
  members: ProjectMemberRecord[] = [];
  auditEvents: ProjectAuditEvent[] = [];
  accessLocks: boolean[] = [];
  memberLockCalls: Array<{
    projectId: string;
    memberId: string;
    lock: boolean;
  }> = [];
  memberListCalls = 0;
  nextSequenceCalls = 0;
  touchCalls = 0;
  addError: unknown = null;
  touchReturnsNull = false;
  private nextSequenceValue = 20;

  async listProjects(): Promise<ProjectRecordPage> {
    throw new Error("Not used by member service tests");
  }

  async listOwnerUserIds(): Promise<
    readonly { projectId: string; userId: string }[]
  > {
    throw new Error("Not used by member service tests");
  }

  async transaction<T>(
    work: (transaction: ProjectTransaction) => Promise<T>
  ): Promise<T> {
    const projects = structuredClone(this.projects);
    const members = structuredClone(this.members);
    const auditEvents = structuredClone(this.auditEvents);
    const nextSequenceCalls = this.nextSequenceCalls;
    const touchCalls = this.touchCalls;
    try {
      return await work(this);
    } catch (error) {
      this.projects = projects;
      this.members = members;
      this.auditEvents = auditEvents;
      this.nextSequenceCalls = nextSequenceCalls;
      this.touchCalls = touchCalls;
      throw error;
    }
  }

  async getAccess(
    projectId: string,
    userId: string,
    lock: boolean
  ): Promise<ProjectAccessRecord> {
    this.accessLocks.push(lock);
    return {
      project: this.projects.get(projectId) ?? null,
      memberRole:
        this.members.find(
          (member) => member.projectId === projectId && member.userId === userId
        )?.memberRole ?? null
    };
  }

  async createProject(_input: CreateProjectRecord): Promise<ProjectRecord> {
    void _input;
    throw new Error("Not used by member service tests");
  }

  async updateProject(
    _input: UpdateProjectRecord
  ): Promise<ProjectRecord | null> {
    void _input;
    throw new Error("Not used by member service tests");
  }

  async setLifecycle(
    _input: SetProjectLifecycleRecord
  ): Promise<ProjectRecord | null> {
    void _input;
    throw new Error("Not used by member service tests");
  }

  async touchProject(
    projectId: string,
    actorUserId: string,
    occurredAt: string,
    commitSequence: number
  ): Promise<ProjectRecord | null> {
    this.touchCalls += 1;
    if (this.touchReturnsNull) {
      return null;
    }
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
    this.projects.set(projectId, project);
    return project;
  }

  async getMember(
    projectId: string,
    memberId: string,
    lock: boolean
  ): Promise<ProjectMemberRecord | null> {
    this.memberLockCalls.push({ projectId, memberId, lock });
    return (
      this.members.find(
        (member) => member.projectId === projectId && member.id === memberId
      ) ?? null
    );
  }

  async listMembers(projectId: string): Promise<ProjectMemberRecord[]> {
    this.memberListCalls += 1;
    return this.members.filter((member) => member.projectId === projectId);
  }

  async addMember(input: CreateMemberRecord): Promise<ProjectMemberRecord> {
    if (this.addError !== null) {
      throw this.addError;
    }
    const member = memberRecord(
      input.projectId,
      input.userId,
      input.memberRole,
      {
        id: input.id,
        jobTitle: input.jobTitle,
        phone: input.phone,
        remark: input.remark,
        createdAt: input.occurredAt,
        createdBy: input.actorUserId,
        updatedAt: input.occurredAt,
        updatedBy: input.actorUserId
      }
    );
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
    const member = {
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
    this.auditEvents.push(structuredClone(event));
  }

  async listAudit(
    _projectId: string,
    _page: number,
    _pageSize: number
  ): Promise<ProjectAuditRecordPage> {
    void [_projectId, _page, _pageSize];
    throw new Error("Not used by member service tests");
  }

  async nextCommitSequence(): Promise<number> {
    this.nextSequenceCalls += 1;
    this.nextSequenceValue += 1;
    return this.nextSequenceValue;
  }
}

interface MemberServiceHarness {
  service: MemberService;
  repository: FakeMemberRepository;
  store: CountingMemoryAuthStateStore;
  principal: AuthenticatedPrincipal;
  principalMemberId: string | null;
  candidateUserId: string;
  projectId: string;
}

function createMemberServiceHarness(
  options: {
    principalRole?: SystemRole;
    memberRole?: ProjectMemberRole | null;
    lifecycle?: ProjectLifecycle;
    ownerCount?: number;
  } = {}
): MemberServiceHarness {
  const principalRole = options.principalRole ?? "USER";
  const principalUser = storedUser({
    username: "principal.member",
    role: principalRole
  });
  const candidate = storedUser({ username: "candidate.member" });
  const session = storedSession(principalUser.id);
  const state = emptyState();
  state.users.push(principalUser, candidate);
  state.sessions.push(session);
  const store = new CountingMemoryAuthStateStore(state);
  const repository = new FakeMemberRepository();
  const project = projectRecord(
    principalUser.id,
    options.lifecycle ?? "ACTIVE"
  );
  repository.projects.set(project.id, project);

  let principalMemberId: string | null = null;
  if (options.memberRole !== null) {
    const principalMember = memberRecord(
      project.id,
      principalUser.id,
      options.memberRole ?? "OWNER"
    );
    repository.members.push(principalMember);
    principalMemberId = principalMember.id;
  }
  const currentOwners = repository.members.filter(
    ({ memberRole }) => memberRole === "OWNER"
  ).length;
  const ownerCount = options.ownerCount ?? Math.max(currentOwners, 1);
  for (let index = currentOwners; index < ownerCount; index += 1) {
    repository.members.push(
      memberRecord(project.id, randomUUID(), "OWNER", {
        jobTitle: `虚构负责人 ${index + 1}`
      })
    );
  }

  const principal = {
    userId: principalUser.id,
    sessionId: session.id,
    role: principalRole
  };
  const authorization = new AuthorizationService(store, {
    now: () => new Date(currentTime),
    generateId: randomUUID
  });
  const service = new MemberService(repository, authorization, store, {
    now: () => new Date(currentTime),
    generateId: randomUUID
  });

  return {
    service,
    repository,
    store,
    principal,
    principalMemberId,
    candidateUserId: candidate.id,
    projectId: project.id
  };
}

const validMemberInput: MemberInput = {
  memberRole: "VIEWER",
  jobTitle: "虚构观察员",
  phone: "000-0000-0000",
  remark: "虚构测试备注"
};

describe("MemberService member visibility", () => {
  it.each(["OWNER", "EDITOR", "VIEWER"] as const)(
    "allows %s project readers to list members",
    async (memberRole) => {
      const harness = createMemberServiceHarness({ memberRole });

      const result = await harness.service.listMembers(
        harness.principal,
        harness.projectId
      );

      expect(result).toHaveLength(harness.repository.members.length);
      expect(result[0]).toMatchObject({
        member: { userId: harness.principal.userId, memberRole },
        user: {
          id: harness.principal.userId,
          username: "principal.member",
          accountStatus: "ACTIVE"
        }
      });
      expect(harness.repository.accessLocks).toEqual([false]);
    }
  );

  it("keeps archived project members readable and unresolved users visible", async () => {
    const harness = createMemberServiceHarness({
      memberRole: "VIEWER",
      lifecycle: "ARCHIVED"
    });
    const unresolved = memberRecord(harness.projectId, randomUUID(), "EDITOR");
    harness.repository.members.push(unresolved);

    const result = await harness.service.listMembers(
      harness.principal,
      harness.projectId
    );

    expect(result).toContainEqual({ member: unresolved, user: null });
  });

  it("hides missing projects behind PROJECT_NOT_FOUND", async () => {
    const harness = createMemberServiceHarness({ memberRole: "VIEWER" });

    await expect(
      harness.service.listMembers(harness.principal, randomUUID())
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});

describe("MemberService project existence hiding", () => {
  it.each(["list", "search", "add", "update", "remove"] as const)(
    "returns PROJECT_NOT_FOUND for nonmember USER %s",
    async (operation) => {
      const harness = createMemberServiceHarness({ memberRole: null });
      const targetMemberId = harness.repository.members[0]!.id;
      const requests = {
        list: () =>
          harness.service.listMembers(harness.principal, harness.projectId),
        search: () =>
          harness.service.searchCandidates(
            harness.principal,
            harness.projectId,
            "candidate"
          ),
        add: () =>
          harness.service.addMember(harness.principal, harness.projectId, {
            userId: harness.candidateUserId,
            ...validMemberInput
          }),
        update: () =>
          harness.service.updateMember(
            harness.principal,
            harness.projectId,
            targetMemberId,
            validMemberInput
          ),
        remove: () =>
          harness.service.removeMember(
            harness.principal,
            harness.projectId,
            targetMemberId
          )
      };

      await expect(requests[operation]()).rejects.toMatchObject({
        code: "PROJECT_NOT_FOUND"
      });
    }
  );

  it("does not expose unavailable candidates before hidden-project authorization", async () => {
    const harness = createMemberServiceHarness({ memberRole: null });
    const unavailable = storedUser({
      username: "hidden.disabled",
      accountStatus: "DISABLED"
    });
    await harness.store.update((state) => state.users.push(unavailable));

    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: unavailable.id,
        ...validMemberInput
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("does not expose invalid update input before hidden-project authorization", async () => {
    const harness = createMemberServiceHarness({ memberRole: null });

    await expect(
      harness.service.updateMember(
        harness.principal,
        harness.projectId,
        harness.repository.members[0]!.id,
        { ...validMemberInput, phone: "x".repeat(51) }
      )
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});

describe("MemberService candidate search", () => {
  it("rejects fewer than two trimmed Unicode code points before reading users", async () => {
    const harness = createMemberServiceHarness();
    harness.store.readCalls = 0;

    await expect(
      harness.service.searchCandidates(
        harness.principal,
        harness.projectId,
        "  展  "
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(harness.store.readCalls).toBe(0);
  });

  it("rejects one trimmed code point even when lower-casing expands it", async () => {
    const harness = createMemberServiceHarness();
    harness.store.readCalls = 0;

    await expect(
      harness.service.searchCandidates(
        harness.principal,
        harness.projectId,
        "  İ  "
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(harness.store.readCalls).toBe(0);
  });

  it("allows two trimmed Unicode code points to reach user search", async () => {
    const harness = createMemberServiceHarness();
    harness.store.readCalls = 0;

    await expect(
      harness.service.searchCandidates(
        harness.principal,
        harness.projectId,
        "  展陈  "
      )
    ).resolves.toEqual([]);
    expect(harness.store.readCalls).toBe(1);
  });

  it("returns at most 20 available nonmembers matching username or display name", async () => {
    const harness = createMemberServiceHarness();
    const existing = storedUser({ username: "search.existing" });
    const disabled = storedUser({
      username: "search.disabled",
      accountStatus: "DISABLED"
    });
    const pending = storedUser({
      username: "search.pending",
      credentialStatus: "PENDING_ACTIVATION"
    });
    const matching = Array.from({ length: 24 }, (_, index) =>
      storedUser({
        username: `search.person.${String(index).padStart(2, "0")}`,
        displayName: `候选搜索 ${index}`
      })
    );
    await harness.store.update((state) => {
      state.users.push(existing, disabled, pending, ...matching);
    });
    harness.repository.members.push(
      memberRecord(harness.projectId, existing.id, "VIEWER")
    );

    const result = await harness.service.searchCandidates(
      harness.principal,
      harness.projectId,
      "  SEARCH.  "
    );

    expect(result).toHaveLength(20);
    expect(result).toEqual(
      matching.slice(0, 20).map(({ id, username, displayName }) => ({
        id,
        username,
        displayName
      }))
    );
  });

  it.each(["EDITOR", "VIEWER"] as const)(
    "rejects candidate search for %s",
    async (memberRole) => {
      const harness = createMemberServiceHarness({ memberRole });

      await expect(
        harness.service.searchCandidates(
          harness.principal,
          harness.projectId,
          "candidate"
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("rejects candidate search for archived projects", async () => {
    const harness = createMemberServiceHarness({ lifecycle: "ARCHIVED" });

    await expect(
      harness.service.searchCandidates(
        harness.principal,
        harness.projectId,
        "candidate"
      )
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_STATE" });
  });
});

describe("MemberService additions", () => {
  it.each([
    ["OWNER", true],
    ["EDITOR", false],
    ["VIEWER", false]
  ] as const)(
    "maps %s member management permission",
    async (memberRole, allowed) => {
      const harness = createMemberServiceHarness({
        principalRole: "USER",
        memberRole,
        ownerCount: 2
      });
      const request = harness.service.addMember(
        harness.principal,
        harness.projectId,
        { userId: harness.candidateUserId, ...validMemberInput }
      );

      if (allowed) {
        await expect(request).resolves.toMatchObject({
          member: { memberRole: "VIEWER" },
          user: { id: harness.candidateUserId }
        });
      } else {
        await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  );

  it("allows ADMIN without project membership to add a member", async () => {
    const harness = createMemberServiceHarness({
      principalRole: "ADMIN",
      memberRole: null
    });

    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: harness.candidateUserId,
        ...validMemberInput
      })
    ).resolves.toMatchObject({ member: { userId: harness.candidateUserId } });
  });

  it("rejects a read-only LEADER without project membership", async () => {
    const harness = createMemberServiceHarness({
      principalRole: "LEADER",
      memberRole: null
    });

    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: harness.candidateUserId,
        ...validMemberInput
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("touches the project and writes exactly one safe audit event", async () => {
    const harness = createMemberServiceHarness();
    const beforeRevision = harness.repository.projects.get(
      harness.projectId
    )!.revision;

    const result = await harness.service.addMember(
      harness.principal,
      harness.projectId,
      { userId: harness.candidateUserId, ...validMemberInput }
    );

    expect(harness.repository.nextSequenceCalls).toBe(1);
    expect(harness.repository.touchCalls).toBe(1);
    expect(harness.repository.accessLocks).toEqual([true]);
    expect(harness.repository.projects.get(harness.projectId)?.revision).toBe(
      beforeRevision + 1
    );
    expect(harness.repository.auditEvents).toHaveLength(1);
    expect(harness.repository.auditEvents[0]).toMatchObject({
      commitSequence: 21,
      eventType: "MEMBER_ADDED",
      targetType: "PROJECT_MEMBER",
      targetId: result.member.id,
      changeSummary: {
        fields: ["memberRole", "jobTitle", "phone", "remark"],
        after: { memberRole: "VIEWER" }
      }
    });
    expect(JSON.stringify(harness.repository.auditEvents[0])).not.toContain(
      validMemberInput.phone
    );
    expect(JSON.stringify(harness.repository.auditEvents[0])).not.toContain(
      validMemberInput.remark
    );
  });

  it("maps only the project member user unique constraint", async () => {
    const harness = createMemberServiceHarness();
    harness.repository.addError = {
      code: "23505",
      constraint: "project_members_project_id_user_id_key"
    };

    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: harness.candidateUserId,
        ...validMemberInput
      })
    ).rejects.toMatchObject({ code: "MEMBER_ALREADY_EXISTS" });
    expect(harness.repository.auditEvents).toEqual([]);

    const otherError = {
      code: "23505",
      constraint: "fictional_other_unique_constraint"
    };
    harness.repository.addError = otherError;
    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: harness.candidateUserId,
        ...validMemberInput
      })
    ).rejects.toBe(otherError);
  });

  it.each([
    ["disabled.member", "DISABLED", "READY"],
    ["pending.member", "ACTIVE", "PENDING_ACTIVATION"]
  ] as const)(
    "rejects unavailable candidate %s",
    async (username, accountStatus, credentialStatus) => {
      const harness = createMemberServiceHarness();
      const unavailable = storedUser({
        username,
        accountStatus,
        credentialStatus
      });
      await harness.store.update((state) => state.users.push(unavailable));

      await expect(
        harness.service.addMember(harness.principal, harness.projectId, {
          userId: unavailable.id,
          ...validMemberInput
        })
      ).rejects.toMatchObject({ code: "USER_NOT_AVAILABLE" });
      expect(harness.repository.nextSequenceCalls).toBe(0);
    }
  );

  it("rejects invalid member input and archived projects without mutation", async () => {
    const invalidHarness = createMemberServiceHarness();
    await expect(
      invalidHarness.service.addMember(
        invalidHarness.principal,
        invalidHarness.projectId,
        {
          userId: invalidHarness.candidateUserId,
          ...validMemberInput,
          phone: "x".repeat(51)
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const archivedHarness = createMemberServiceHarness({
      lifecycle: "ARCHIVED"
    });
    await expect(
      archivedHarness.service.addMember(
        archivedHarness.principal,
        archivedHarness.projectId,
        { userId: archivedHarness.candidateUserId, ...validMemberInput }
      )
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_STATE" });
    expect(archivedHarness.repository.nextSequenceCalls).toBe(0);
  });
});

describe("MemberService updates", () => {
  it("does not sequence, touch, or audit a no-op update", async () => {
    const harness = createMemberServiceHarness({ ownerCount: 2 });
    const target = harness.repository.members[0]!;
    const input: MemberInput = {
      memberRole: target.memberRole,
      jobTitle: target.jobTitle,
      phone: target.phone,
      remark: target.remark
    };

    const result = await harness.service.updateMember(
      harness.principal,
      harness.projectId,
      target.id,
      input
    );

    expect(result.member).toEqual(target);
    expect(harness.repository.nextSequenceCalls).toBe(0);
    expect(harness.repository.touchCalls).toBe(0);
    expect(harness.repository.auditEvents).toEqual([]);
    expect(harness.repository.memberLockCalls).toEqual([
      { projectId: harness.projectId, memberId: target.id, lock: true }
    ]);
    expect(harness.repository.memberListCalls).toBe(0);
  });

  it("audits changed profile field names without profile values", async () => {
    const harness = createMemberServiceHarness({ ownerCount: 2 });
    const target = harness.repository.members[0]!;
    const input: MemberInput = {
      memberRole: "EDITOR",
      jobTitle: "虚构新岗位",
      phone: "111-1111-1111",
      remark: "虚构新备注"
    };

    const result = await harness.service.updateMember(
      harness.principal,
      harness.projectId,
      target.id,
      input
    );

    expect(result.member).toMatchObject(input);
    expect(harness.repository.nextSequenceCalls).toBe(1);
    expect(harness.repository.touchCalls).toBe(1);
    expect(harness.repository.auditEvents).toHaveLength(1);
    expect(harness.repository.memberLockCalls).toEqual([
      { projectId: harness.projectId, memberId: target.id, lock: true }
    ]);
    expect(harness.repository.memberListCalls).toBe(0);
    expect(harness.repository.auditEvents[0]).toMatchObject({
      eventType: "MEMBER_UPDATED",
      targetId: target.id,
      changeSummary: {
        fields: ["memberRole", "jobTitle", "phone", "remark"],
        before: { memberRole: "OWNER" },
        after: { memberRole: "EDITOR" }
      }
    });
    const auditJson = JSON.stringify(harness.repository.auditEvents[0]);
    expect(auditJson).not.toContain(input.jobTitle);
    expect(auditJson).not.toContain(input.phone);
    expect(auditJson).not.toContain(input.remark);
  });

  it("rejects demoting the last owner", async () => {
    const harness = createMemberServiceHarness({
      memberRole: "OWNER",
      ownerCount: 1
    });

    await expect(
      harness.service.updateMember(
        harness.principal,
        harness.projectId,
        harness.principalMemberId!,
        { ...validMemberInput, memberRole: "EDITOR" }
      )
    ).rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
    expect(harness.repository.members[0]?.memberRole).toBe("OWNER");
    expect(harness.repository.nextSequenceCalls).toBe(0);
  });

  it("returns MEMBER_NOT_FOUND only after project authorization", async () => {
    const harness = createMemberServiceHarness();

    await expect(
      harness.service.updateMember(
        harness.principal,
        harness.projectId,
        randomUUID(),
        validMemberInput
      )
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
  });
});

describe("MemberService removals", () => {
  it("rejects removing the last owner", async () => {
    const harness = createMemberServiceHarness({
      memberRole: "OWNER",
      ownerCount: 1
    });

    await expect(
      harness.service.removeMember(
        harness.principal,
        harness.projectId,
        harness.principalMemberId!
      )
    ).rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
    expect(harness.repository.members).toHaveLength(1);
    expect(harness.repository.nextSequenceCalls).toBe(0);
  });

  it("removes a member, touches the project, and writes one safe audit", async () => {
    const harness = createMemberServiceHarness({ ownerCount: 2 });
    const targetUser = storedUser({ username: "removal.target" });
    await harness.store.update((state) => state.users.push(targetUser));
    const target = memberRecord(harness.projectId, targetUser.id, "EDITOR", {
      phone: "222-2222-2222",
      remark: "虚构待删除备注"
    });
    harness.repository.members.push(target);

    await harness.service.removeMember(
      harness.principal,
      harness.projectId,
      target.id
    );

    expect(harness.repository.members).not.toContainEqual(target);
    expect(harness.repository.nextSequenceCalls).toBe(1);
    expect(harness.repository.touchCalls).toBe(1);
    expect(harness.repository.auditEvents).toHaveLength(1);
    expect(harness.repository.memberLockCalls).toEqual([
      { projectId: harness.projectId, memberId: target.id, lock: true }
    ]);
    expect(harness.repository.memberListCalls).toBe(0);
    expect(harness.repository.auditEvents[0]).toMatchObject({
      eventType: "MEMBER_REMOVED",
      targetId: target.id,
      changeSummary: {
        fields: ["memberRole", "jobTitle", "phone", "remark"],
        before: { memberRole: "EDITOR" }
      }
    });
    const auditJson = JSON.stringify(harness.repository.auditEvents[0]);
    expect(auditJson).not.toContain(target.phone);
    expect(auditJson).not.toContain(target.remark);
  });

  it.each(["EDITOR", "VIEWER"] as const)(
    "rejects member removal for %s",
    async (memberRole) => {
      const harness = createMemberServiceHarness({ memberRole });

      await expect(
        harness.service.removeMember(
          harness.principal,
          harness.projectId,
          harness.principalMemberId!
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("rejects removals from archived projects", async () => {
    const harness = createMemberServiceHarness({ lifecycle: "ARCHIVED" });

    await expect(
      harness.service.removeMember(
        harness.principal,
        harness.projectId,
        harness.principalMemberId!
      )
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_STATE" });
  });
});

describe("MemberService transaction safety", () => {
  it("rolls back a member mutation when touchProject unexpectedly misses", async () => {
    const harness = createMemberServiceHarness();
    harness.repository.touchReturnsNull = true;

    await expect(
      harness.service.addMember(harness.principal, harness.projectId, {
        userId: harness.candidateUserId,
        ...validMemberInput
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(
      harness.repository.members.some(
        ({ userId }) => userId === harness.candidateUserId
      )
    ).toBe(false);
    expect(harness.repository.auditEvents).toEqual([]);
  });
});
