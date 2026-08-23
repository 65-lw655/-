// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ProjectListFilters, ProjectRecord } from "@project-online/domain";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectListView } from "./ProjectListView.js";
import type { ProjectPage, ProjectRepository } from "./repository.js";

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const actorId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name: "城市展馆项目",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "现场施工",
    filingStatus: "已归档",
    plannedCompletionDate: "2026-10-01",
    actualCompletionDate: null,
    lifecycle: "ACTIVE",
    createdAt: "2026-08-11T08:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-08-20T09:30:00.000Z",
    updatedBy: actorId,
    revision: 2,
    commitSequence: 3,
    archivedAt: null,
    archivedBy: null,
    ...overrides
  };
}

function page(overrides: Partial<ProjectPage> = {}): ProjectPage {
  return {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    ...overrides
  };
}

function createRepository(
  listProjects: ProjectRepository["listProjects"] = vi
    .fn<ProjectRepository["listProjects"]>()
    .mockResolvedValue(page())
): ProjectRepository {
  return {
    listProjects,
    getProject: vi.fn(),
    updateProject: vi.fn()
  };
}

describe("ProjectListView", () => {
  it("loads projects, shows the pending badge only for pending items, and opens the selected project", async () => {
    const filters: ProjectListFilters = {
      query: "",
      year: undefined,
      status: undefined,
      lifecycle: undefined,
      page: 1,
      pageSize: 20
    };
    const onOpenProject = vi.fn();
    const repository = createRepository(
      vi.fn().mockResolvedValue(
        page({
          items: [
            {
              project: project({ id: "project-pending", name: "本机项目-A" }),
              ownerLabels: ["张三"],
              syncState: "PENDING"
            },
            {
              project: project({ id: "project-synced", name: "本机项目-B" }),
              ownerLabels: ["李四"],
              syncState: "SYNCED"
            }
          ],
          total: 2
        })
      )
    );

    render(
      <ProjectListView
        filters={filters}
        onFiltersChange={vi.fn()}
        onOpenProject={onOpenProject}
        repository={repository}
      />
    );

    expect(repository.listProjects).toHaveBeenCalledWith(filters);

    const table = await screen.findByRole("table");
    const pendingRow = within(table).getByRole("button", { name: "本机项目-A" })
      .closest("tr");
    const syncedRow = within(table).getByRole("button", { name: "本机项目-B" })
      .closest("tr");

    expect(within(pendingRow!).getByText("待同步")).toBeVisible();
    expect(within(syncedRow!).queryByText("待同步")).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: "本机项目-A" }));
    expect(onOpenProject).toHaveBeenCalledWith("project-pending");
  });
});
