import * as fileSystem from "node:fs/promises";

import type {
  ProjectAuditEvent,
  ProjectMemberRecord,
  ProjectRecord
} from "@project-online/domain";
import { describe, expect, it, vi } from "vitest";

import type {
  CreateMemberRecord,
  CreateProjectRecord,
  ProjectTransaction
} from "../modules/projects/project-repository.js";
import { seedFictionalData } from "./seed-fictional.js";

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const adminUserId = "f1c71000-0000-4000-8000-000000000101";
const ownerUserId = "f1c71000-0000-4000-8000-000000000102";
const projectId = "f1c71000-0000-4000-8000-000000000001";
const memberId = "f1c71000-0000-4000-8000-000000000002";
const auditEventId = "f1c71000-0000-4000-8000-000000000003";
type SeedTransaction = Pick<
  ProjectTransaction,
  | "getAccess"
  | "nextCommitSequence"
  | "createProject"
  | "addMember"
  | "writeAudit"
>;

class FakeSeedRepository {
  readonly calls: string[] = [];
  readonly createdProjects: CreateProjectRecord[] = [];
  readonly createdMembers: CreateMemberRecord[] = [];
  readonly auditEvents: ProjectAuditEvent[] = [];
  private readonly projects = new Map<string, ProjectRecord>();
  auditError?: Error;
  nextSequence = 41;

  async transaction<T>(
    work: (transaction: SeedTransaction) => Promise<T>
  ): Promise<T> {
    this.calls.push("transaction");
    return work({
      getAccess: async (requestedProjectId) => {
        this.calls.push("getAccess");
        return {
          project: this.projects.get(requestedProjectId) ?? null,
          memberRole: null
        };
      },
      nextCommitSequence: async () => {
        this.calls.push("nextCommitSequence");
        return this.nextSequence;
      },
      createProject: async (input) => {
        this.calls.push("createProject");
        this.createdProjects.push(input);
        const project: ProjectRecord = {
          id: input.id,
          name: input.name,
          year: input.year,
          type: input.type,
          status: input.status,
          phase: input.phase,
          lifecycle: "ACTIVE",
          filingStatus: input.filingStatus,
          plannedCompletionDate: input.plannedCompletionDate,
          actualCompletionDate: input.actualCompletionDate,
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
      },
      addMember: async (input) => {
        this.calls.push("addMember");
        this.createdMembers.push(input);
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
        return member;
      },
      writeAudit: async (event) => {
        this.calls.push("writeAudit");
        if (this.auditError) {
          throw this.auditError;
        }
        this.auditEvents.push(event);
      }
    });
  }
}

describe("seedFictionalData", () => {
  it.each([undefined, "", "YES", " yes", "yes "])(
    "rejects confirmation %j before calling the repository",
    async (confirmation) => {
      const repository = new FakeSeedRepository();

      await expect(
        seedFictionalData({
          confirmation,
          adminUserId,
          ownerUserId,
          repository
        })
      ).rejects.toThrow("SEED_FICTIONAL_DATA=yes is required");
      expect(repository.calls).toEqual([]);
    }
  );

  it.each([
    ["empty ADMIN", "   ", ownerUserId],
    ["invalid ADMIN", "not-a-uuid", ownerUserId],
    ["empty OWNER", adminUserId, "\n"],
    ["invalid OWNER", adminUserId, "F1C71000-0000-4000-8000-00000000010Z"]
  ])(
    "rejects an %s ID before calling the repository",
    async (_label, suppliedAdminUserId, suppliedOwnerUserId) => {
      const repository = new FakeSeedRepository();

      await expect(
        seedFictionalData({
          confirmation: "yes",
          adminUserId: suppliedAdminUserId,
          ownerUserId: suppliedOwnerUserId,
          repository
        })
      ).rejects.toThrow("Explicit fictional user IDs are required");
      expect(repository.calls).toEqual([]);
    }
  );

  it("uses trimmed valid UUIDs while preserving hexadecimal case", async () => {
    const repository = new FakeSeedRepository();
    const uppercaseAdminUserId = adminUserId.toUpperCase();

    await seedFictionalData({
      confirmation: "yes",
      adminUserId: `  ${uppercaseAdminUserId}  `,
      ownerUserId: `\t${ownerUserId}\n`,
      repository
    });

    expect(repository.createdProjects[0]?.actorUserId).toBe(
      uppercaseAdminUserId
    );
    expect(repository.createdMembers[0]).toMatchObject({
      userId: ownerUserId,
      actorUserId: uppercaseAdminUserId
    });
    expect(repository.auditEvents[0]?.actorUserId).toBe(uppercaseAdminUserId);
  });

  it("creates fixed fictional records once without reading files", async () => {
    const repository = new FakeSeedRepository();
    const readFileSpy = vi.mocked(fileSystem.readFile);

    await seedFictionalData({
      confirmation: "yes",
      adminUserId,
      ownerUserId,
      repository
    });
    await seedFictionalData({
      confirmation: "yes",
      adminUserId,
      ownerUserId,
      repository
    });

    expect(repository.calls).toEqual([
      "transaction",
      "getAccess",
      "nextCommitSequence",
      "createProject",
      "addMember",
      "writeAudit",
      "transaction",
      "getAccess"
    ]);
    expect(repository.createdProjects).toEqual([
      expect.objectContaining({
        id: projectId,
        name: "示例-项目核心演示",
        actorUserId: adminUserId,
        commitSequence: 41
      })
    ]);
    expect(repository.createdMembers).toEqual([
      expect.objectContaining({
        id: memberId,
        projectId,
        userId: ownerUserId,
        memberRole: "OWNER",
        actorUserId: adminUserId
      })
    ]);
    expect(repository.auditEvents).toEqual([
      expect.objectContaining({
        id: auditEventId,
        projectId,
        commitSequence: 41,
        eventType: "PROJECT_CREATED",
        actorUserId: adminUserId,
        targetType: "PROJECT",
        targetId: projectId
      })
    ]);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("passes repository errors through unchanged", async () => {
    const repository = new FakeSeedRepository();
    const repositoryError = new Error("fictional repository failure");
    repository.auditError = repositoryError;

    await expect(
      seedFictionalData({
        confirmation: "yes",
        adminUserId,
        ownerUserId,
        repository
      })
    ).rejects.toBe(repositoryError);
  });
});
