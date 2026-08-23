import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ProjectInput, ProjectListFilters } from "@project-online/domain";
import {
  ProjectRepositoryError,
  type ProjectDetails,
  type ProjectPage
} from "@project-online/ui";
import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../platform/desktop-bridge.js";
import { createLocalProjectRepository } from "./local-project-repository.js";

function projectPage(): ProjectPage {
  return {
    items: [
      {
        project: projectDetails().project,
        ownerLabels: [],
        syncState: "PENDING"
      }
    ],
    page: 1,
    pageSize: 20,
    total: 1
  };
}

function projectDetails(): ProjectDetails {
  return {
    project: {
      id: "00000000-0000-4000-8000-0000000000f5",
      name: "示例-离线本地项目",
      year: 2026,
      type: "展览展示",
      status: "施工中",
      phase: "深化设计",
      filingStatus: "未归档",
      plannedCompletionDate: "2026-10-01",
      actualCompletionDate: null,
      lifecycle: "ACTIVE",
      createdAt: "2026-08-20T08:00:00.000Z",
      createdBy: "local-fictional-user",
      updatedAt: "2026-08-22T09:30:00.000Z",
      updatedBy: "local-fictional-user",
      revision: 1,
      commitSequence: 1,
      archivedAt: null,
      archivedBy: null
    },
    permissions: {
      canEdit: true,
      canManageMembers: false,
      canChangeLifecycle: false,
      canReadAudit: false
    },
    syncState: "SYNCED"
  };
}

function projectInput(): ProjectInput {
  return {
    name: "示例-离线本地项目",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "深化设计",
    filingStatus: "未归档",
    plannedCompletionDate: "2026-10-01",
    actualCompletionDate: null
  };
}

function bridgeStub(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    listProjects: vi.fn().mockResolvedValue(projectPage()),
    getProject: vi.fn().mockResolvedValue(projectDetails()),
    updateProject: vi.fn().mockResolvedValue(projectDetails()),
    getLocalStatus: vi.fn().mockResolvedValue({
      deviceId: "00000000-0000-4000-8000-0000000000d5",
      pendingCount: 0
    }),
    ...overrides
  };
}

describe("local project repository", () => {
  it("forwards list filters and preserves item syncState", async () => {
    const filters: ProjectListFilters = { page: 1, pageSize: 20, query: "示例" };
    const bridge = bridgeStub();
    const repository = createLocalProjectRepository(bridge);

    await expect(repository.listProjects(filters)).resolves.toEqual(projectPage());

    expect(bridge.listProjects).toHaveBeenCalledWith(filters);
  });

  it("forwards project detail and preserves detail syncState", async () => {
    const bridge = bridgeStub();
    const repository = createLocalProjectRepository(bridge);
    const projectId = "00000000-0000-4000-8000-0000000000f5";

    await expect(repository.getProject(projectId)).resolves.toEqual(
      projectDetails()
    );

    expect(bridge.getProject).toHaveBeenCalledWith(projectId);
  });

  it("maps PROJECT_NOT_FOUND to the shared repository error", async () => {
    const bridge = bridgeStub({
      getProject: vi.fn().mockRejectedValue({
        code: "PROJECT_NOT_FOUND",
        message: "missing"
      })
    });
    const repository = createLocalProjectRepository(bridge);

    await expect(
      repository.getProject("00000000-0000-4000-8000-00000000ffff")
    ).rejects.toMatchObject(
      new ProjectRepositoryError("PROJECT_NOT_FOUND", "项目不存在或您无权查看")
    );
  });

  it("forwards updateProject through the bridge", async () => {
    const input = projectInput();
    const bridge = bridgeStub();
    const repository = createLocalProjectRepository(bridge);
    const projectId = "00000000-0000-4000-8000-0000000000f5";

    await expect(repository.updateProject(projectId, input)).resolves.toEqual(
      projectDetails()
    );

    expect(bridge.updateProject).toHaveBeenCalledWith(projectId, input);
  });

  it("keeps SQL out of the TypeScript adapter", () => {
    const sourcePath = fileURLToPath(
      new URL("./local-project-repository.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/\b(SELECT|INSERT|UPDATE)\b/i);
  });
});
