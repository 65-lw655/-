// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ProjectPermissions, ProjectRecord } from "@project-online/domain";
import {
  createEvent,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectEditorDialog } from "./ProjectEditorDialog.js";
import {
  ProjectRepositoryError,
  type ProjectDetails,
  type ProjectRepository
} from "./repository.js";

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

function details(overrides: Partial<ProjectRecord> = {}): ProjectDetails {
  return {
    project: project(overrides),
    permissions: permissions()
  };
}

function createRepository(
  updateProject: ProjectRepository["updateProject"] = vi
    .fn<ProjectRepository["updateProject"]>()
    .mockResolvedValue(details({ name: "示例-编辑后项目" }))
): ProjectRepository {
  return {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    updateProject
  };
}

afterEach(() => {
  cleanup();
});

describe("ProjectEditorDialog", () => {
  it("validates input, updates once, and refreshes with the returned details", async () => {
    const updateProject = vi
      .fn<ProjectRepository["updateProject"]>()
      .mockResolvedValue(details({ name: "示例-编辑后项目" }));
    const onSaved = vi.fn();

    render(
      <ProjectEditorDialog
        details={details()}
        onClose={vi.fn()}
        onSaved={onSaved}
        repository={createRepository(updateProject)}
      />
    );

    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    expect(updateProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "示例-编辑后项目" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(details({ name: "示例-编辑后项目" }));
  });

  it("maps forbidden and validation failures without treating offline state as a save failure", async () => {
    const onClose = vi.fn();
    const forbiddenRepository = createRepository(
      vi
        .fn<ProjectRepository["updateProject"]>()
        .mockRejectedValue(
          new ProjectRepositoryError(
            "PROJECT_FORBIDDEN",
            "您没有编辑项目的权限"
          )
        )
    );
    const validationRepository = createRepository(
      vi.fn<ProjectRepository["updateProject"]>().mockRejectedValue(
        new ProjectRepositoryError("VALIDATION_FAILED", "字段校验失败", {
          fieldErrors: { name: "项目名称不能为空" }
        })
      )
    );

    const { rerender } = render(
      <ProjectEditorDialog
        details={details()}
        onClose={onClose}
        onSaved={vi.fn()}
        repository={forbiddenRepository}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByText("您没有编辑项目的权限")).toBeVisible();

    rerender(
      <ProjectEditorDialog
        details={details()}
        onClose={onClose}
        onSaved={vi.fn()}
        repository={validationRepository}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByText("项目名称不能为空")).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "编辑项目" })
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("离线状态导致保存失败")).toBeNull();
  });

  it("prevents and stops Escape before closing the dialog", async () => {
    const parentKeyDown = vi.fn();
    const onClose = vi.fn();

    render(
      <div onKeyDown={parentKeyDown}>
        <ProjectEditorDialog
          details={details()}
          onClose={onClose}
          onSaved={vi.fn()}
          repository={createRepository()}
        />
      </div>
    );

    const dialog = screen.getByRole("dialog", { name: "编辑项目" });
    const event = createEvent.keyDown(dialog, {
      bubbles: true,
      cancelable: true,
      key: "Escape"
    });

    fireEvent(dialog, event);

    expect(event.defaultPrevented).toBe(true);
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
