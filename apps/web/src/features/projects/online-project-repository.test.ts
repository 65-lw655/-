import type { ProjectInput, ProjectListFilters } from "@project-online/domain";
import { ProjectRepositoryError } from "@project-online/ui";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../api-client.js";
import type {
  ProjectDetails,
  ProjectPage,
  ProjectsClient,
  ProjectUserSummary
} from "./projects-client.js";
import { createOnlineProjectRepository } from "./online-project-repository.js";

function projectPage(): ProjectPage {
  const owner = (displayName: string): ProjectUserSummary => ({
    id: crypto.randomUUID(),
    username: `${displayName}-user`,
    displayName,
    accountStatus: "ACTIVE"
  });

  return {
    items: [
      {
        project: {
          id: crypto.randomUUID(),
          name: "城市展馆项目",
          year: 2026,
          type: "展览展示",
          status: "施工中",
          phase: "现场施工",
          filingStatus: "待归档",
          plannedCompletionDate: "2026-10-01",
          actualCompletionDate: null,
          lifecycle: "ACTIVE",
          createdAt: "2026-08-11T08:00:00.000Z",
          createdBy: crypto.randomUUID(),
          updatedAt: "2026-08-20T09:30:00.000Z",
          updatedBy: crypto.randomUUID(),
          revision: 2,
          commitSequence: 3,
          archivedAt: null,
          archivedBy: null
        },
        owners: [owner("张三"), owner("李四")]
      }
    ],
    page: 1,
    pageSize: 20,
    total: 1
  };
}

function projectDetails(): ProjectDetails {
  return {
    project: projectPage().items[0]!.project,
    permissions: {
      canEdit: true,
      canManageMembers: true,
      canChangeLifecycle: true,
      canReadAudit: true
    }
  };
}

function createClientStub(
  overrides: Partial<ProjectsClient> = {}
): ProjectsClient {
  return {
    listProjects: vi.fn().mockResolvedValue(projectPage()),
    listInitialOwnerCandidates: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getProject: vi.fn().mockResolvedValue(projectDetails()),
    updateProject: vi.fn().mockResolvedValue(projectDetails()),
    archiveProject: vi.fn(),
    restoreProject: vi.fn(),
    listMembers: vi.fn(),
    searchMemberCandidates: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    listAuditEvents: vi.fn(),
    ...overrides
  };
}

describe("online-project-repository", () => {
  it("forwards list and maps owner display names", async () => {
    const filters: ProjectListFilters = { page: 2, pageSize: 20, query: "展馆" };
    const expectedPage = projectPage();
    const client = createClientStub({
      listProjects: vi.fn().mockResolvedValue(expectedPage)
    });
    const repository = createOnlineProjectRepository(client);

    const page = await repository.listProjects(filters);

    expect(client.listProjects).toHaveBeenCalledTimes(1);
    expect(client.listProjects).toHaveBeenCalledWith(filters);
    expect(page.items[0]).toMatchObject({
      ownerLabels: ["张三", "李四"]
    });
  });

  it("forwards getProject once", async () => {
    const expectedDetails = projectDetails();
    const client = createClientStub({
      getProject: vi.fn().mockResolvedValue(expectedDetails)
    });
    const repository = createOnlineProjectRepository(client);
    const projectId = crypto.randomUUID();

    const details = await repository.getProject(projectId);

    expect(client.getProject).toHaveBeenCalledTimes(1);
    expect(client.getProject).toHaveBeenCalledWith(projectId);
    expect(details).toEqual(expectedDetails);
  });

  it("forwards updateProject once", async () => {
    const input: ProjectInput = {
      name: "城市展馆项目",
      year: 2026,
      type: "展览展示",
      status: "施工中",
      phase: "现场施工",
      filingStatus: "待归档",
      plannedCompletionDate: "2026-10-01",
      actualCompletionDate: null
    };
    const expectedDetails = projectDetails();
    const client = createClientStub({
      updateProject: vi.fn().mockResolvedValue(expectedDetails)
    });
    const repository = createOnlineProjectRepository(client);
    const projectId = crypto.randomUUID();

    const details = await repository.updateProject(projectId, input);

    expect(client.updateProject).toHaveBeenCalledTimes(1);
    expect(client.updateProject).toHaveBeenCalledWith(projectId, input);
    expect(details).toEqual(expectedDetails);
  });

  it("maps session expiry to authentication required", async () => {
    const client = createClientStub({
      getProject: vi
        .fn<ProjectsClient["getProject"]>()
        .mockRejectedValue(
          new ApiClientError(401, "SESSION_EXPIRED", "会话已过期")
        )
    });
    const repository = createOnlineProjectRepository(client);

    await expect(repository.getProject(crypto.randomUUID())).rejects.toMatchObject(
      new ProjectRepositoryError("AUTHENTICATION_REQUIRED", "请重新登录")
    );
  });
});
