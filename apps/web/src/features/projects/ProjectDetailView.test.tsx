// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  ProjectAuditEvent,
  ProjectPermissions,
  ProjectRecord
} from "@project-online/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../api-client.js";
import { ProjectDetailView } from "./ProjectDetailView.js";
import { ProjectsView } from "./ProjectsView.js";
import type {
  ProjectAuditPage,
  ProjectAuditView,
  ProjectDetails,
  ProjectsClient,
  ProjectUserSummary
} from "./projects-client.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const secondProjectId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: projectId,
    name: "示例-项目详情",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "现场施工",
    filingStatus: "待归档",
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

function permissions(
  overrides: Partial<ProjectPermissions> = {}
): ProjectPermissions {
  return {
    canEdit: true,
    canManageMembers: true,
    canChangeLifecycle: true,
    canReadAudit: true,
    ...overrides
  };
}

function details(
  projectOverrides: Partial<ProjectRecord> = {},
  permissionOverrides: Partial<ProjectPermissions> = {}
): ProjectDetails {
  return {
    project: project(projectOverrides),
    permissions: permissions(permissionOverrides)
  };
}

function auditEvent(
  sequence: number,
  overrides: Partial<ProjectAuditEvent> = {}
): ProjectAuditEvent {
  return {
    id: crypto.randomUUID(),
    projectId,
    commitSequence: sequence,
    eventType: "PROJECT_UPDATED",
    actorUserId: actorId,
    targetType: "PROJECT",
    targetId: projectId,
    changeSummary: {
      fields: ["name"],
      before: { name: "旧项目名称" },
      after: { name: "新项目名称" }
    },
    occurredAt: `2026-08-20T09:${String(sequence).padStart(2, "0")}:00.000Z`,
    ...overrides
  };
}

function actor(
  overrides: Partial<ProjectUserSummary> = {}
): ProjectUserSummary {
  return {
    id: actorId,
    username: "audit.user",
    displayName: "审计用户",
    accountStatus: "ACTIVE",
    ...overrides
  };
}

function auditView(
  sequence: number,
  overrides: Partial<ProjectAuditView> = {}
): ProjectAuditView {
  return {
    event: auditEvent(sequence),
    actor: actor(),
    ...overrides
  };
}

function auditPage(
  items: ProjectAuditView[],
  page: number,
  total = items.length
): ProjectAuditPage {
  return { items, page, pageSize: 20, total };
}

function createProjectsClientStub(
  overrides: Partial<ProjectsClient> = {}
): ProjectsClient {
  return {
    listProjects: vi.fn(),
    listInitialOwnerCandidates: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getProject: vi.fn().mockResolvedValue(details()),
    updateProject: vi.fn().mockResolvedValue(details()),
    archiveProject: vi.fn().mockResolvedValue(
      details({
        lifecycle: "ARCHIVED",
        archivedAt: "2026-08-21T10:00:00.000Z",
        archivedBy: actorId
      })
    ),
    restoreProject: vi.fn().mockResolvedValue(details()),
    listMembers: vi.fn(),
    searchMemberCandidates: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    listAuditEvents: vi.fn().mockResolvedValue(auditPage([], 1, 0)),
    ...overrides
  };
}

function renderDetail(
  client: ProjectsClient,
  overrides: Partial<{
    projectId: string;
    onBack(): void;
    onSessionExpired(): void;
  }> = {}
) {
  return render(
    <ProjectDetailView
      client={client}
      onBack={overrides.onBack ?? vi.fn()}
      onSessionExpired={overrides.onSessionExpired ?? vi.fn()}
      projectId={overrides.projectId ?? projectId}
    />
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("ProjectDetailView", () => {
  it("loads and renders eight base fields plus lifecycle and updated time", async () => {
    const request = deferred<ProjectDetails>();
    const client = createProjectsClientStub({
      getProject: vi.fn(() => request.promise)
    });
    renderDetail(client);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目详情");
    request.resolve(details());

    expect(
      await screen.findByRole("heading", { name: "示例-项目详情" })
    ).toBeInTheDocument();
    const detailList = screen.getByLabelText("项目基础信息");
    for (const value of [
      "2026",
      "展览展示",
      "施工中",
      "现场施工",
      "待归档",
      "2026-10-01",
      "未填写",
      "启用中",
      "2026-08-20T09:30:00.000Z"
    ]) {
      expect(within(detailList).getByText(value)).toBeInTheDocument();
    }
  });

  it("renders every action exclusively from server permission flags", async () => {
    const client = createProjectsClientStub({
      getProject: vi.fn().mockResolvedValue(
        details(
          {},
          {
            canEdit: false,
            canManageMembers: true,
            canChangeLifecycle: false,
            canReadAudit: true
          }
        )
      )
    });
    renderDetail(client);

    expect(
      await screen.findByRole("heading", { name: "示例-项目详情" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "编辑项目" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "项目成员" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("成员管理将在下一任务中提供")
    ).not.toBeInTheDocument();
    expect(await screen.findByText("暂无项目成员")).toBeInTheDocument();
    expect(client.listMembers).toHaveBeenCalledWith(projectId);
    expect(
      screen.queryByRole("button", { name: "归档项目" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看审计记录" })
    ).toBeInTheDocument();
  });

  it("reuses edit mode, avoids global users, and applies returned details", async () => {
    const listInitialOwnerCandidates = vi.fn().mockResolvedValue([]);
    const updateProject = vi
      .fn()
      .mockResolvedValue(
        details(
          { name: "示例-编辑后项目", updatedAt: "2026-08-21T11:00:00.000Z" },
          { canEdit: false }
        )
      );
    const client = createProjectsClientStub({
      listInitialOwnerCandidates,
      updateProject
    });
    renderDetail(client);

    fireEvent.click(await screen.findByRole("button", { name: "编辑项目" }));
    expect(
      screen.getByRole("dialog", { name: "编辑项目" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("项目名称")).toHaveValue("示例-项目详情");
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "示例-编辑后项目" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(
      await screen.findByRole("heading", { name: "示例-编辑后项目" })
    ).toBeInTheDocument();
    expect(updateProject).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ name: "示例-编辑后项目" })
    );
    expect(listInitialOwnerCandidates).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "编辑项目" })
    ).not.toBeInTheDocument();
  });

  it.each([
    [403, "您没有查看此项目的权限"],
    [404, "项目不存在或您无权查看"]
  ])("shows the safe detail state for HTTP %s", async (status, message) => {
    const client = createProjectsClientStub({
      getProject: vi
        .fn()
        .mockRejectedValue(
          new ApiClientError(status, "REQUEST_FAILED", "内部信息")
        )
    });
    renderDetail(client);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("内部信息")).not.toBeInTheDocument();
  });

  it("retries detail loading after a network failure", async () => {
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce(details());
    renderDetail(createProjectsClientStub({ getProject }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "项目详情加载失败，请重试"
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载项目" }));

    expect(
      await screen.findByRole("heading", { name: "示例-项目详情" })
    ).toBeInTheDocument();
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("notifies session expiry when detail loading returns 401", async () => {
    const onSessionExpired = vi.fn();
    const client = createProjectsClientStub({
      getProject: vi
        .fn()
        .mockRejectedValue(
          new ApiClientError(401, "SESSION_EXPIRED", "请重新登录")
        )
    });
    renderDetail(client, { onSessionExpired });

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });

  it("clears old details and ignores a superseded project request", async () => {
    const firstRequest = deferred<ProjectDetails>();
    const secondRequest = deferred<ProjectDetails>();
    const getProject = vi.fn((requestedProjectId: string) =>
      requestedProjectId === projectId
        ? firstRequest.promise
        : secondRequest.promise
    );
    const client = createProjectsClientStub({ getProject });
    const view = renderDetail(client);

    view.rerender(
      <ProjectDetailView
        client={client}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={secondProjectId}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目详情");

    firstRequest.resolve(details({ name: "过期项目" }));
    secondRequest.resolve(details({ id: secondProjectId, name: "当前项目" }));

    expect(
      await screen.findByRole("heading", { name: "当前项目" })
    ).toBeInTheDocument();
    expect(screen.queryByText("过期项目")).not.toBeInTheDocument();
  });

  it("confirms archive and restore, closes on cancel or Escape, and blocks duplicates", async () => {
    const archiveRequest = deferred<ProjectDetails>();
    const restoreRequest = deferred<ProjectDetails>();
    const archiveProject = vi.fn(() => archiveRequest.promise);
    const restoreProject = vi.fn(() => restoreRequest.promise);
    const client = createProjectsClientStub({ archiveProject, restoreProject });
    renderDetail(client);

    const archiveButton = await screen.findByRole("button", {
      name: "归档项目"
    });
    fireEvent.click(archiveButton);
    expect(archiveProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消归档" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(archiveButton).toHaveFocus();

    fireEvent.click(archiveButton);
    fireEvent.click(screen.getByRole("button", { name: "取消归档" }));
    expect(archiveProject).not.toHaveBeenCalled();

    fireEvent.click(archiveButton);
    const confirmArchive = screen.getByRole("button", { name: "确认归档" });
    fireEvent.click(confirmArchive);
    fireEvent.click(confirmArchive);
    const archiveDialog = screen.getByRole("alertdialog");
    const cancelArchive = within(archiveDialog).getByRole("button", {
      name: "取消归档"
    });
    expect(archiveProject).toHaveBeenCalledOnce();
    expect(confirmArchive).toBeDisabled();
    expect(cancelArchive).toBeDisabled();
    expect(archiveDialog).toHaveFocus();
    fireEvent.keyDown(archiveDialog, { key: "Tab" });
    expect(archiveDialog).toHaveFocus();
    fireEvent.click(cancelArchive);
    fireEvent.keyDown(archiveDialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(archiveProject).toHaveBeenCalledOnce();
    archiveRequest.resolve(
      details({
        lifecycle: "ARCHIVED",
        archivedAt: "2026-08-21T10:00:00.000Z",
        archivedBy: actorId
      })
    );

    const restoreButton = await screen.findByRole("button", {
      name: "恢复项目"
    });
    fireEvent.click(restoreButton);
    expect(restoreProject).not.toHaveBeenCalled();
    const confirmRestore = screen.getByRole("button", { name: "确认恢复" });
    fireEvent.click(confirmRestore);
    fireEvent.click(confirmRestore);
    const restoreDialog = screen.getByRole("alertdialog");
    const cancelRestore = within(restoreDialog).getByRole("button", {
      name: "取消恢复"
    });
    expect(confirmRestore).toBeDisabled();
    expect(cancelRestore).toBeDisabled();
    fireEvent.click(cancelRestore);
    fireEvent.keyDown(restoreDialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(restoreProject).toHaveBeenCalledOnce();
    restoreRequest.resolve(details());

    expect(
      await screen.findByRole("button", { name: "归档项目" })
    ).toBeInTheDocument();
    expect(restoreProject).toHaveBeenCalledOnce();
  });

  it("traps Tab focus inside lifecycle confirmation and skips disabled controls", async () => {
    renderDetail(createProjectsClientStub());

    fireEvent.click(await screen.findByRole("button", { name: "归档项目" }));
    const cancelButton = screen.getByRole("button", { name: "取消归档" });
    const confirmButton = screen.getByRole("button", { name: "确认归档" });

    confirmButton.focus();
    fireEvent.keyDown(confirmButton, { key: "Tab" });
    expect(cancelButton).toHaveFocus();

    cancelButton.focus();
    fireEvent.keyDown(cancelButton, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();

    cancelButton.setAttribute("disabled", "");
    confirmButton.focus();
    fireEvent.keyDown(confirmButton, { key: "Tab" });
    expect(confirmButton).toHaveFocus();
  });

  it.each([
    [403, "FORBIDDEN", "您没有变更项目生命周期的权限"],
    [409, "LIFECYCLE_CONFLICT", "项目状态已变化，请重试"],
    [0, "NETWORK_ERROR", "项目生命周期变更失败，请重试"]
  ])(
    "keeps retryable lifecycle HTTP %s feedback inside the alertdialog",
    async (status, code, message) => {
      const archiveProject = vi
        .fn()
        .mockRejectedValue(
          new ApiClientError(status, code, "服务端内部错误信息")
        );
      renderDetail(createProjectsClientStub({ archiveProject }));

      fireEvent.click(await screen.findByRole("button", { name: "归档项目" }));
      fireEvent.click(screen.getByRole("button", { name: "确认归档" }));

      const dialog = screen.getByRole("alertdialog");
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        message
      );
      expect(
        within(dialog).getByRole("button", { name: "确认归档" })
      ).toBeEnabled();
      expect(screen.getByText("启用中")).toBeInTheDocument();
      expect(screen.queryByText("服务端内部错误信息")).not.toBeInTheDocument();
    }
  );

  it("closes lifecycle confirmation and enters hidden state after 404", async () => {
    const archiveProject = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(404, "PROJECT_NOT_FOUND", "资源内部信息")
      );
    renderDetail(createProjectsClientStub({ archiveProject }));

    fireEvent.click(await screen.findByRole("button", { name: "归档项目" }));
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "项目不存在或您无权查看"
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("启用中")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "归档项目" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("资源内部信息")).not.toBeInTheDocument();
  });

  it("only notifies session expiry for lifecycle 401", async () => {
    const onSessionExpired = vi.fn();
    const archiveProject = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(401, "SESSION_EXPIRED", "会话内部错误")
      );
    renderDetail(createProjectsClientStub({ archiveProject }), {
      onSessionExpired
    });

    fireEvent.click(await screen.findByRole("button", { name: "归档项目" }));
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(
      within(screen.getByRole("alertdialog")).queryByRole("alert")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("会话内部错误")).not.toBeInTheDocument();
  });

  it("loads audit pages on demand, appends items, and reloads after reopening", async () => {
    const listAuditEvents = vi.fn((_: string, page: number) =>
      Promise.resolve(
        page === 1
          ? auditPage([auditView(3), auditView(2)], 1, 3)
          : auditPage([auditView(1)], 2, 3)
      )
    );
    renderDetail(createProjectsClientStub({ listAuditEvents }));

    expect(listAuditEvents).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "查看审计记录" })
    );
    expect(await screen.findByText("提交序号 3")).toBeInTheDocument();
    expect(listAuditEvents).toHaveBeenCalledWith(projectId, 1);

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("提交序号 1")).toBeInTheDocument();
    expect(screen.getByText("提交序号 3")).toBeInTheDocument();
    expect(listAuditEvents).toHaveBeenCalledWith(projectId, 2);
    expect(
      screen.queryByRole("button", { name: "加载更多" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭审计记录" }));
    expect(screen.queryByText("提交序号 3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledTimes(3));
    expect(listAuditEvents).toHaveBeenLastCalledWith(projectId, 1);
  });

  it.each(["old-first", "new-first"] as const)(
    "isolates superseded audit responses when %s resolves first",
    async (completionOrder) => {
      const oldRequest = deferred<ProjectAuditPage>();
      const currentRequest = deferred<ProjectAuditPage>();
      const listAuditEvents = vi
        .fn<ProjectsClient["listAuditEvents"]>()
        .mockImplementationOnce(() => oldRequest.promise)
        .mockImplementationOnce(() => currentRequest.promise)
        .mockResolvedValueOnce(auditPage([auditView(1)], 2, 2));
      renderDetail(createProjectsClientStub({ listAuditEvents }));

      fireEvent.click(
        await screen.findByRole("button", { name: "查看审计记录" })
      );
      fireEvent.click(screen.getByRole("button", { name: "关闭审计记录" }));
      fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
      expect(listAuditEvents).toHaveBeenCalledTimes(2);

      if (completionOrder === "old-first") {
        oldRequest.resolve(auditPage([auditView(9)], 1, 1));
        await oldRequest.promise;
        await Promise.resolve();
        expect(screen.queryByText("提交序号 9")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
          "正在加载审计记录"
        );
        currentRequest.resolve(auditPage([auditView(2)], 1, 2));
      } else {
        currentRequest.resolve(auditPage([auditView(2)], 1, 2));
        expect(await screen.findByText("提交序号 2")).toBeInTheDocument();
        oldRequest.resolve(auditPage([auditView(9)], 1, 1));
        await oldRequest.promise;
        await Promise.resolve();
      }

      expect(await screen.findByText("提交序号 2")).toBeInTheDocument();
      expect(screen.queryByText("提交序号 9")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
      expect(await screen.findByText("提交序号 1")).toBeInTheDocument();
      expect(listAuditEvents).toHaveBeenLastCalledWith(projectId, 2);
      expect(listAuditEvents).toHaveBeenCalledTimes(3);
    }
  );

  it("renders actor fallbacks and sensitive audit field names without values", async () => {
    const sensitiveEvent = auditEvent(8, {
      changeSummary: {
        fields: ["name", "memberRole", "jobTitle", "phone", "remark"],
        before: {
          name: "旧项目名称",
          memberRole: "VIEWER"
        },
        after: {
          name: "新项目名称",
          memberRole: "EDITOR"
        }
      }
    });
    const listAuditEvents = vi.fn().mockResolvedValue(
      auditPage(
        [
          auditView(8, { event: sensitiveEvent }),
          auditView(7, {
            actor: actor({ displayName: "", username: "fallback.user" })
          }),
          auditView(6, { actor: null })
        ],
        1,
        3
      )
    );
    renderDetail(createProjectsClientStub({ listAuditEvents }));

    fireEvent.click(
      await screen.findByRole("button", { name: "查看审计记录" })
    );
    expect(
      await screen.findByText((_, element) =>
        Boolean(
          element?.tagName === "P" &&
          element.textContent?.includes("操作人：审计用户")
        )
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "P" &&
          element.textContent?.includes("操作人：fallback.user")
        )
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "P" &&
          element.textContent?.includes("操作人：未知用户")
        )
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("PROJECT_UPDATED")).toHaveLength(3);
    expect(screen.getByText("2026-08-20T09:08:00.000Z")).toBeInTheDocument();
    expect(
      screen.getAllByText(/项目名称（name）.*旧项目名称.*新项目名称/)
    ).toHaveLength(3);
    expect(
      screen.getByText(/项目角色（memberRole）.*VIEWER.*EDITOR/)
    ).toBeInTheDocument();
    for (const label of [
      "职位（jobTitle）",
      "电话（phone）",
      "备注（remark）"
    ]) {
      expect(screen.getByText(`${label}：字段已变更`)).toBeInTheDocument();
    }
  });

  it("handles audit 403, 401, initial retry, and load-more retry without clearing items", async () => {
    const onSessionExpired = vi.fn();
    const listAuditEvents = vi
      .fn<ProjectsClient["listAuditEvents"]>()
      .mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN", "forbidden"))
      .mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce(auditPage([auditView(2)], 1, 2))
      .mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce(auditPage([auditView(1)], 2, 2))
      .mockRejectedValueOnce(
        new ApiClientError(401, "AUTHENTICATION_REQUIRED", "login")
      );
    renderDetail(createProjectsClientStub({ listAuditEvents }), {
      onSessionExpired
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "查看审计记录" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "您没有查看审计记录的权限"
    );

    fireEvent.click(screen.getByRole("button", { name: "重试加载审计记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "审计记录加载失败，请重试"
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载审计记录" }));
    expect(await screen.findByText("提交序号 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "更多审计记录加载失败，请重试"
    );
    expect(screen.getByText("提交序号 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载更多" }));
    expect(await screen.findByText("提交序号 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭审计记录" }));
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});

describe("ProjectsView detail navigation", () => {
  it("preserves URL filters and page while refreshing list data after return", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects?query=%E5%B1%95%E9%A6%86&year=2026&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&lifecycle=ACTIVE&page=2"
    );
    const oldItem = project({ name: "示例-旧展馆" });
    const updatedItem = project({
      name: "示例-更新后展馆",
      updatedAt: "2026-08-21T12:00:00.000Z"
    });
    const listRequests: URL[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path === "/api/v1/projects") {
        listRequests.push(url);
      }
      const payload =
        path === `/api/v1/projects/${projectId}`
          ? details({ name: "示例-详情展馆" })
          : {
              items: [
                {
                  project: listRequests.length === 1 ? oldItem : updatedItem,
                  owners: [actor({ displayName: "项目负责人" })]
                }
              ],
              page: 2,
              pageSize: 20,
              total: 40
            };
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }) as typeof fetch;
    const onOpenProject = vi.fn();
    render(
      <ProjectsView
        apiBaseUrl="http://localhost/api"
        fetchImpl={fetchImpl}
        onOpenProject={onOpenProject}
        onSessionExpired={vi.fn()}
        sessionUser={{ userId: actorId, role: "USER" }}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "示例-旧展馆" }));
    expect(
      await screen.findByRole("heading", { name: "示例-详情展馆" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "返回项目列表" })
    ).toBeInTheDocument();
    expect(onOpenProject).toHaveBeenCalledWith(projectId);

    fireEvent.click(screen.getByRole("button", { name: "返回项目列表" }));
    expect(
      await screen.findByRole("button", { name: "示例-更新后展馆" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "示例-旧展馆" })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("项目名称关键字")).toHaveValue("展馆");
    expect(screen.getByLabelText("年度")).toHaveValue(2026);
    expect(screen.getByLabelText("状态")).toHaveValue("施工中");
    expect(screen.getByLabelText("生命周期")).toHaveValue("ACTIVE");
    expect(screen.getByText("第 2 页")).toBeInTheDocument();
    expect(window.location.search).toBe(
      "?query=%E5%B1%95%E9%A6%86&year=2026&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&lifecycle=ACTIVE&page=2"
    );
    expect(listRequests).toHaveLength(2);
    expect(
      listRequests.map((url) => Object.fromEntries(url.searchParams))
    ).toEqual([
      {
        query: "展馆",
        year: "2026",
        status: "施工中",
        lifecycle: "ACTIVE",
        page: "2",
        pageSize: "20"
      },
      {
        query: "展馆",
        year: "2026",
        status: "施工中",
        lifecycle: "ACTIVE",
        page: "2",
        pageSize: "20"
      }
    ]);
  });
});
