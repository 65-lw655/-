// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ProjectPermissions, ProjectRecord } from "@project-online/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectDetailView } from "./ProjectDetailView.js";
import type { ProjectDetails, ProjectRepository } from "./repository.js";

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "示例-缓存项目",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "现场施工",
    filingStatus: "待归档",
    plannedCompletionDate: "2026-10-01",
    actualCompletionDate: null,
    lifecycle: "ACTIVE",
    createdAt: "2026-08-11T08:00:00.000Z",
    createdBy: "33333333-3333-4333-8333-333333333333",
    updatedAt: "2026-08-20T09:30:00.000Z",
    updatedBy: "33333333-3333-4333-8333-333333333333",
    revision: 2,
    commitSequence: 3,
    archivedAt: null,
    archivedBy: null,
    ...overrides
  };
}

function permissions(
  overrides: Partial<ProjectPermissions> = {}
): ProjectPermissions {
  return {
    canEdit: true,
    canManageMembers: false,
    canChangeLifecycle: false,
    canReadAudit: false,
    ...overrides
  };
}

function details(
  permissionOverrides: Partial<ProjectPermissions> = {}
): ProjectDetails {
  return {
    project: project(),
    permissions: permissions(permissionOverrides)
  };
}

function createRepository(
  getProject: ProjectRepository["getProject"] = vi
    .fn<ProjectRepository["getProject"]>()
    .mockResolvedValue(details())
): ProjectRepository {
  return {
    listProjects: vi.fn(),
    getProject,
    updateProject: vi.fn()
  };
}

describe("ProjectDetailView", () => {
  it("displays cached fields and only enables edit when canEdit is true", async () => {
    const noEditRepository = createRepository(
      vi.fn().mockResolvedValue(details({ canEdit: false }))
    );
    const { rerender } = render(
      <ProjectDetailView
        onBack={vi.fn()}
        projectId="11111111-1111-4111-8111-111111111111"
        repository={noEditRepository}
      />
    );

    expect(
      await screen.findByRole("heading", { name: "示例-缓存项目" })
    ).toBeVisible();
    expect(screen.getByText("2026")).toBeVisible();
    expect(screen.getByText("展览展示")).toBeVisible();
    expect(screen.getByText("施工中")).toBeVisible();
    expect(screen.queryByRole("button", { name: "编辑项目" })).toBeNull();

    rerender(
      <ProjectDetailView
        onBack={vi.fn()}
        projectId="11111111-1111-4111-8111-111111111111"
        repository={createRepository()}
      />
    );

    expect(
      await screen.findByRole("button", { name: "编辑项目" })
    ).toBeVisible();
  });
});
