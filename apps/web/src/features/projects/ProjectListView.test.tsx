// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { PROJECT_STATUSES, type ProjectRecord } from "@project-online/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../api-client.js";
import { ProjectListView } from "./ProjectListView.js";
import type {
  ProjectPage,
  ProjectsClient,
  ProjectUserSummary
} from "./projects-client.js";

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

function owner(displayName: string): ProjectUserSummary {
  return {
    id: crypto.randomUUID(),
    username: `owner-${crypto.randomUUID()}`,
    displayName,
    accountStatus: "ACTIVE"
  };
}

function projectPage(overrides: Partial<ProjectPage> = {}): ProjectPage {
  return {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    ...overrides
  };
}

function createProjectsClientStub(
  listProjects: ProjectsClient["listProjects"] = vi
    .fn<ProjectsClient["listProjects"]>()
    .mockResolvedValue(projectPage())
): ProjectsClient {
  return {
    listProjects,
    listInitialOwnerCandidates: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    restoreProject: vi.fn(),
    listMembers: vi.fn(),
    searchMemberCandidates: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    listAuditEvents: vi.fn()
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/projects");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("ProjectListView", () => {
  it("shows loading before the first project page resolves", () => {
    const request = deferred<ProjectPage>();
    const client = createProjectsClientStub(() => request.promise);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目");
  });

  it("distinguishes an empty list from filtered no results", async () => {
    const client = createProjectsClientStub();
    const { unmount } = render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    expect(await screen.findByText("暂无项目")).toBeInTheDocument();
    unmount();

    window.history.replaceState({}, "", "/projects?query=展馆");
    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    expect(
      await screen.findByText("没有符合筛选条件的项目")
    ).toBeInTheDocument();
  });

  it("renders the required columns, owners, and project opening boundary", async () => {
    const onOpenProject = vi.fn();
    const item = project();
    const client = createProjectsClientStub(
      vi.fn().mockResolvedValue(
        projectPage({
          items: [{ project: item, owners: [owner("张三"), owner("李四")] }],
          total: 1
        })
      )
    );

    render(
      <ProjectListView
        client={client}
        onOpenProject={onOpenProject}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    const table = await screen.findByRole("table");
    for (const heading of [
      "项目名称",
      "年度",
      "类型",
      "状态",
      "阶段",
      "负责人",
      "更新时间",
      "生命周期"
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: heading })
      ).toBeInTheDocument();
    }
    expect(within(table).getByText("张三、李四")).toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: item.name }));
    expect(onOpenProject).toHaveBeenCalledWith(item.id);
  });

  it("shows create only to administrators", async () => {
    const client = createProjectsClientStub();
    const onCreateProject = vi.fn();
    const { rerender } = render(
      <ProjectListView
        client={client}
        onCreateProject={onCreateProject}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );
    await screen.findByText("暂无项目");
    expect(
      screen.queryByRole("button", { name: "新建项目" })
    ).not.toBeInTheDocument();

    rerender(
      <ProjectListView
        client={client}
        onCreateProject={onCreateProject}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="LEADER"
      />
    );
    expect(
      screen.queryByRole("button", { name: "新建项目" })
    ).not.toBeInTheDocument();

    rerender(
      <ProjectListView
        client={client}
        onCreateProject={onCreateProject}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="ADMIN"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it("writes every filter and page to the URL, then resets page on filtering", async () => {
    const listProjects = vi
      .fn<ProjectsClient["listProjects"]>()
      .mockResolvedValue(projectPage({ total: 41 }));
    const client = createProjectsClientStub(listProjects);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );
    await screen.findByText("暂无项目");

    fireEvent.change(screen.getByLabelText("项目名称关键字"), {
      target: { value: "展馆" }
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("query")).toBe(
        "展馆"
      )
    );

    fireEvent.change(screen.getByLabelText("年度"), {
      target: { value: "2026" }
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("year")).toBe(
        "2026"
      )
    );

    fireEvent.change(screen.getByLabelText("状态"), {
      target: { value: PROJECT_STATUSES[1] }
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("status")).toBe(
        PROJECT_STATUSES[1]
      )
    );

    fireEvent.change(screen.getByLabelText("生命周期"), {
      target: { value: "ARCHIVED" }
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("lifecycle")).toBe(
        "ARCHIVED"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("page")).toBe("2")
    );

    fireEvent.change(screen.getByLabelText("项目名称关键字"), {
      target: { value: "更新" }
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has("page")).toBe(
        false
      )
    );
    expect(listProjects).toHaveBeenLastCalledWith({
      query: "更新",
      year: 2026,
      status: PROJECT_STATUSES[1],
      lifecycle: "ARCHIVED",
      page: 1,
      pageSize: 20
    });
  });

  it("keeps partial year input while only valid years reach the URL", async () => {
    const client = createProjectsClientStub();
    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );
    await screen.findByText("暂无项目");

    const yearInput = screen.getByLabelText("年度");
    fireEvent.change(yearInput, { target: { value: "2" } });
    expect(yearInput).toHaveValue(2);
    expect(new URLSearchParams(window.location.search).has("year")).toBe(false);

    fireEvent.change(yearInput, { target: { value: "2026" } });
    await waitFor(() => expect(yearInput).toHaveValue(2026));
    expect(new URLSearchParams(window.location.search).get("year")).toBe(
      "2026"
    );
  });

  it("strictly ignores invalid URL filters and restores valid popstate filters", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects?year=invalid&status=unknown&lifecycle=DELETED&page=NaN"
    );
    const listProjects = vi
      .fn<ProjectsClient["listProjects"]>()
      .mockResolvedValue(projectPage());
    const client = createProjectsClientStub(listProjects);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    await waitFor(() => {
      expect(listProjects).toHaveBeenCalledWith({
        query: "",
        page: 1,
        pageSize: 20
      });
    });
    expect(screen.getByLabelText("年度")).toHaveValue(null);

    window.history.pushState(
      {},
      "",
      `/projects?query=恢复&year=2025&status=${encodeURIComponent(PROJECT_STATUSES[2])}&lifecycle=ACTIVE&page=3`
    );
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.getByLabelText("项目名称关键字")).toHaveValue("恢复");
      expect(screen.getByLabelText("年度")).toHaveValue(2025);
      expect(screen.getByLabelText("状态")).toHaveValue(PROJECT_STATUSES[2]);
      expect(screen.getByLabelText("生命周期")).toHaveValue("ACTIVE");
      expect(listProjects).toHaveBeenLastCalledWith({
        query: "恢复",
        year: 2025,
        status: PROJECT_STATUSES[2],
        lifecycle: "ACTIVE",
        page: 3,
        pageSize: 20
      });
    });
  });

  it("falls back to page one for an unsafe page number", async () => {
    window.history.replaceState({}, "", `/projects?page=${"9".repeat(400)}`);
    const listProjects = vi
      .fn<ProjectsClient["listProjects"]>()
      .mockResolvedValue(projectPage());
    const client = createProjectsClientStub(listProjects);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    await waitFor(() =>
      expect(listProjects).toHaveBeenCalledWith({
        query: "",
        page: 1,
        pageSize: 20
      })
    );
  });

  it("shows permission feedback for 403", async () => {
    const client = createProjectsClientStub(() =>
      Promise.reject(new ApiClientError(403, "FORBIDDEN", "forbidden"))
    );

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "您没有查看项目的权限"
    );
  });

  it("offers retry after a network failure", async () => {
    const listProjects = vi
      .fn<ProjectsClient["listProjects"]>()
      .mockRejectedValueOnce(
        new ApiClientError(0, "NETWORK_ERROR", "无法连接 API")
      )
      .mockResolvedValueOnce(projectPage());
    const client = createProjectsClientStub(listProjects);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "项目加载失败，请重试"
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无项目")).toBeInTheDocument();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it.each(["SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"])(
    "notifies session expiry for %s",
    async (code) => {
      const onSessionExpired = vi.fn();
      const client = createProjectsClientStub(() =>
        Promise.reject(new ApiClientError(401, code, "请重新登录"))
      );

      render(
        <ProjectListView
          client={client}
          onOpenProject={vi.fn()}
          onSessionExpired={onSessionExpired}
          sessionRole="USER"
        />
      );

      await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    }
  );

  it("does not let an older request overwrite newer filters", async () => {
    const firstRequest = deferred<ProjectPage>();
    const newerProject = project({ name: "新筛选结果" });
    const listProjects = vi
      .fn<ProjectsClient["listProjects"]>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(
        projectPage({
          items: [{ project: newerProject, owners: [] }],
          total: 1
        })
      );
    const client = createProjectsClientStub(listProjects);

    render(
      <ProjectListView
        client={client}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionRole="USER"
      />
    );
    fireEvent.change(screen.getByLabelText("项目名称关键字"), {
      target: { value: "新" }
    });

    expect(await screen.findByText("新筛选结果")).toBeInTheDocument();
    firstRequest.resolve(
      projectPage({
        items: [{ project: project({ name: "旧请求结果" }), owners: [] }],
        total: 1
      })
    );
    await waitFor(() =>
      expect(screen.queryByText("旧请求结果")).not.toBeInTheDocument()
    );
  });
});
