// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  ProjectMemberRecord,
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
import { ProjectMembersPanel } from "./ProjectMembersPanel.js";
import { ProjectsView } from "./ProjectsView.js";
import type {
  MemberCandidate,
  ProjectAuditPage,
  ProjectDetails,
  ProjectMemberView,
  ProjectsClient,
  ProjectUserSummary
} from "./projects-client.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownerMemberId = "22222222-2222-4222-8222-222222222222";
const editorMemberId = "33333333-3333-4333-8333-333333333333";
const ownerUserId = "44444444-4444-4444-8444-444444444444";
const editorUserId = "55555555-5555-4555-8555-555555555555";
const candidateUserId = "66666666-6666-4666-8666-666666666666";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: projectId,
    name: "示例-成员闭环",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "现场施工",
    filingStatus: "待归档",
    plannedCompletionDate: null,
    actualCompletionDate: null,
    lifecycle: "ACTIVE",
    createdAt: "2026-08-11T08:00:00.000Z",
    createdBy: ownerUserId,
    updatedAt: "2026-08-20T09:30:00.000Z",
    updatedBy: ownerUserId,
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
  permissionOverrides: Partial<ProjectPermissions> = {}
): ProjectDetails {
  return { project: project(), permissions: permissions(permissionOverrides) };
}

function user(overrides: Partial<ProjectUserSummary> = {}): ProjectUserSummary {
  return {
    id: ownerUserId,
    username: "owner.user",
    displayName: "示例负责人",
    accountStatus: "ACTIVE",
    ...overrides
  };
}

function memberRecord(
  overrides: Partial<ProjectMemberRecord> = {}
): ProjectMemberRecord {
  return {
    id: ownerMemberId,
    projectId,
    userId: ownerUserId,
    memberRole: "OWNER",
    jobTitle: "项目经理",
    phone: "13800000000",
    remark: "现场负责",
    createdAt: "2026-08-11T08:00:00.000Z",
    createdBy: ownerUserId,
    updatedAt: "2026-08-20T09:30:00.000Z",
    updatedBy: ownerUserId,
    ...overrides
  };
}

function member(
  memberOverrides: Partial<ProjectMemberRecord> = {},
  userOverrides: Partial<ProjectUserSummary> = {}
): ProjectMemberView {
  return {
    member: memberRecord(memberOverrides),
    user: user(userOverrides)
  };
}

function editorMember(
  overrides: Partial<ProjectMemberRecord> = {},
  userOverrides: Partial<ProjectUserSummary> = {}
): ProjectMemberView {
  return member(
    {
      id: editorMemberId,
      userId: editorUserId,
      memberRole: "EDITOR",
      jobTitle: "",
      phone: "",
      remark: "",
      ...overrides
    },
    {
      id: editorUserId,
      username: "editor.user",
      displayName: "协作成员",
      ...userOverrides
    }
  );
}

function candidate(overrides: Partial<MemberCandidate> = {}): MemberCandidate {
  return {
    id: candidateUserId,
    username: "candidate.user",
    displayName: "候选成员",
    ...overrides
  };
}

function auditPage(label: string, page = 1, total = 1): ProjectAuditPage {
  return {
    items: [
      {
        event: {
          id: crypto.randomUUID(),
          projectId,
          commitSequence: label === "新审计" ? 9 : 1,
          eventType: "MEMBER_UPDATED",
          actorUserId: ownerUserId,
          targetType: "PROJECT_MEMBER",
          targetId: ownerMemberId,
          changeSummary: {
            fields: ["memberRole"],
            after: { memberRole: label }
          },
          occurredAt: "2026-08-21T10:00:00.000Z"
        },
        actor: user()
      }
    ],
    page,
    pageSize: 20,
    total
  };
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
    archiveProject: vi.fn().mockResolvedValue(details()),
    restoreProject: vi.fn().mockResolvedValue(details()),
    listMembers: vi.fn().mockResolvedValue([member(), editorMember()]),
    searchMemberCandidates: vi.fn().mockResolvedValue([candidate()]),
    addMember: vi.fn().mockResolvedValue(
      member(
        {
          id: "77777777-7777-4777-8777-777777777777",
          userId: candidateUserId,
          memberRole: "VIEWER"
        },
        {
          id: candidateUserId,
          username: "candidate.user",
          displayName: "候选成员"
        }
      )
    ),
    updateMember: vi.fn().mockResolvedValue(editorMember()),
    removeMember: vi.fn().mockResolvedValue(undefined),
    listAuditEvents: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    }),
    ...overrides
  };
}

function renderPanel(
  client: ProjectsClient,
  overrides: Partial<{
    canManageMembers: boolean;
    onChanged(): void | Promise<void>;
    onBusyChange(busy: boolean): void;
    onSessionExpired(): void;
  }> = {}
) {
  return render(
    <ProjectMembersPanel
      canManageMembers={overrides.canManageMembers ?? true}
      client={client}
      onBusyChange={overrides.onBusyChange}
      onChanged={overrides.onChanged ?? vi.fn()}
      onSessionExpired={overrides.onSessionExpired ?? vi.fn()}
      projectId={projectId}
    />
  );
}

async function searchAndSelectCandidate(): Promise<void> {
  fireEvent.change(screen.getByLabelText("搜索可添加用户"), {
    target: { value: "  候选  " }
  });
  fireEvent.click(
    await screen.findByRole("radio", { name: "候选成员（candidate.user）" })
  );
}

afterEach(() => cleanup());

describe("ProjectMembersPanel", () => {
  it("loads and fully renders read-only active, disabled, and missing-user records", async () => {
    const listMembers = vi.fn().mockResolvedValue([
      member(),
      editorMember({}, { accountStatus: "DISABLED" }),
      {
        member: memberRecord({
          id: crypto.randomUUID(),
          userId: crypto.randomUUID(),
          memberRole: "VIEWER",
          jobTitle: "",
          phone: "",
          remark: ""
        }),
        user: null
      }
    ]);
    renderPanel(createProjectsClientStub({ listMembers }), {
      canManageMembers: false
    });

    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目成员");
    expect(await screen.findByText("示例负责人")).toBeInTheDocument();
    expect(listMembers).toHaveBeenCalledOnce();
    expect(listMembers).toHaveBeenCalledWith(projectId);
    for (const value of [
      "owner.user",
      "负责人",
      "项目经理",
      "13800000000",
      "现场负责",
      "正常",
      "协作编辑",
      "已停用",
      "只读成员"
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(7);
    expect(
      screen.queryByRole("heading", { name: "新增成员" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^管理/u })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    renderPanel(
      createProjectsClientStub({ listMembers: vi.fn().mockResolvedValue([]) }),
      { canManageMembers: false }
    );
    expect(await screen.findByText("暂无项目成员")).toBeInTheDocument();
  });

  it.each([
    [403, "FORBIDDEN", "您没有查看项目成员的权限"],
    [404, "PROJECT_NOT_FOUND", "项目不存在或您无权查看"]
  ])(
    "shows the safe member state for HTTP %s",
    async (status, code, message) => {
      renderPanel(
        createProjectsClientStub({
          listMembers: vi
            .fn()
            .mockRejectedValue(new ApiClientError(status, code, "内部信息"))
        })
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByText("内部信息")).not.toBeInTheDocument();
    }
  );

  it("retries a failed member load and reports 401 through the callback", async () => {
    const onSessionExpired = vi.fn();
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce([member()])
      .mockRejectedValueOnce(
        new ApiClientError(401, "SESSION_EXPIRED", "会话内部信息")
      );
    const view = renderPanel(createProjectsClientStub({ listMembers }), {
      onSessionExpired
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "项目成员加载失败，请重试"
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载成员" }));
    expect(await screen.findByText("示例负责人")).toBeInTheDocument();

    view.unmount();
    renderPanel(createProjectsClientStub({ listMembers }), {
      onSessionExpired
    });
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(screen.queryByText("会话内部信息")).not.toBeInTheDocument();
  });

  it("uses trimmed Unicode code points and ignores stale candidate results and errors", async () => {
    const first = deferred<MemberCandidate[]>();
    const second = deferred<MemberCandidate[]>();
    const searchMemberCandidates = vi
      .fn<ProjectsClient["searchMemberCandidates"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    renderPanel(createProjectsClientStub({ searchMemberCandidates }));
    await screen.findByText("示例负责人");

    const search = screen.getByLabelText("搜索可添加用户");
    fireEvent.change(search, { target: { value: "  𠮷  " } });
    expect(searchMemberCandidates).not.toHaveBeenCalled();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "  𠮷野  " } });
    fireEvent.change(search, { target: { value: "张三" } });
    expect(searchMemberCandidates).toHaveBeenNthCalledWith(
      1,
      projectId,
      "𠮷野"
    );
    expect(searchMemberCandidates).toHaveBeenNthCalledWith(
      2,
      projectId,
      "张三"
    );

    second.resolve([candidate({ displayName: "当前候选" })]);
    expect(
      await screen.findByRole("radio", { name: "当前候选（candidate.user）" })
    ).toBeInTheDocument();
    first.reject(new ApiClientError(0, "NETWORK_ERROR", "stale secret"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    expect(
      screen.getByRole("radio", { name: "当前候选（candidate.user）" })
    ).toBeInTheDocument();
    expect(screen.queryByText("stale secret")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "𠮷" } });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(searchMemberCandidates).toHaveBeenCalledTimes(2);
  });

  it("adds the selected candidate with all fields once, then reloads and awaits onChanged", async () => {
    const mutation = deferred<ProjectMemberView>();
    const changed = deferred<void>();
    const addMember = vi.fn(() => mutation.promise);
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember()]);
    const onChanged = vi.fn(() => changed.promise);
    renderPanel(createProjectsClientStub({ addMember, listMembers }), {
      onChanged
    });
    await screen.findByText("示例负责人");

    expect(screen.getByRole("button", { name: "添加成员" })).toBeDisabled();
    await searchAndSelectCandidate();
    fireEvent.change(screen.getByLabelText("新成员角色"), {
      target: { value: "EDITOR" }
    });
    fireEvent.change(screen.getByLabelText("新成员职位"), {
      target: { value: "设计师" }
    });
    fireEvent.change(screen.getByLabelText("新成员电话"), {
      target: { value: "13900000000" }
    });
    fireEvent.change(screen.getByLabelText("新成员备注"), {
      target: { value: "设计协作" }
    });

    const submit = screen.getByRole("button", { name: "添加成员" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(addMember).toHaveBeenCalledOnce();
    expect(addMember).toHaveBeenCalledWith(projectId, {
      userId: candidateUserId,
      memberRole: "EDITOR",
      jobTitle: "设计师",
      phone: "13900000000",
      remark: "设计协作"
    });
    expect(submit).toBeDisabled();

    mutation.resolve(editorMember());
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "添加中" })).toBeDisabled();
    changed.resolve();

    expect(await screen.findByRole("status")).toHaveTextContent("成员已添加");
    expect(screen.getByLabelText("搜索可添加用户")).toHaveValue("");
    expect(screen.getByLabelText("新成员角色")).toHaveValue("");
    expect(screen.getByLabelText("新成员职位")).toHaveValue("");
  });

  it("keeps add input after known or unknown mutation failures without exposing internal messages", async () => {
    const addMember = vi
      .fn<ProjectsClient["addMember"]>()
      .mockRejectedValueOnce(
        new ApiClientError(409, "MEMBER_ALREADY_EXISTS", "duplicate internal")
      )
      .mockRejectedValueOnce(
        new ApiClientError(500, "INTERNAL_ERROR", "database internal")
      );
    renderPanel(createProjectsClientStub({ addMember }));
    await screen.findByText("示例负责人");
    await searchAndSelectCandidate();
    fireEvent.change(screen.getByLabelText("新成员角色"), {
      target: { value: "VIEWER" }
    });

    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "该用户已是项目成员"
    );
    expect(screen.getByLabelText("搜索可添加用户")).toHaveValue("  候选  ");
    expect(screen.queryByText("duplicate internal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "成员添加失败，请重试"
    );
    expect(screen.queryByText("database internal")).not.toBeInTheDocument();
  });

  it("offers refresh retry after a successful mutation without repeating it", async () => {
    const retryMembers = deferred<ProjectMemberView[]>();
    const addMember = vi.fn().mockResolvedValue(editorMember());
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member()])
      .mockRejectedValueOnce(new ApiClientError(0, "NETWORK_ERROR", "offline"))
      .mockImplementationOnce(() => retryMembers.promise);
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const onBusyChange = vi.fn();
    renderPanel(createProjectsClientStub({ addMember, listMembers }), {
      onBusyChange,
      onChanged
    });
    await screen.findByText("示例负责人");
    await searchAndSelectCandidate();
    fireEvent.change(screen.getByLabelText("新成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "成员已添加，但项目状态刷新失败"
    );
    expect(addMember).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    onBusyChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试刷新项目状态" }));

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
    expect(screen.getByRole("button", { name: "刷新中" })).toBeDisabled();
    retryMembers.resolve([member(), editorMember()]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "项目状态已刷新"
    );
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([
      true,
      false
    ]);
    expect(addMember).toHaveBeenCalledOnce();
    expect(listMembers).toHaveBeenCalledTimes(3);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("reports derived busy without an initial false and skips refresh after unmount", async () => {
    const mutation = deferred<ProjectMemberView>();
    const listMembers = vi.fn().mockResolvedValue([member()]);
    const onChanged = vi.fn();
    const onBusyChange = vi.fn();
    const view = renderPanel(
      createProjectsClientStub({
        addMember: vi.fn(() => mutation.promise),
        listMembers
      }),
      { onBusyChange, onChanged }
    );
    await screen.findByText("示例负责人");
    expect(onBusyChange).not.toHaveBeenCalled();
    await searchAndSelectCandidate();
    fireEvent.change(screen.getByLabelText("新成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
    view.unmount();
    mutation.resolve(editorMember());
    await mutation.promise;
    await Promise.resolve();

    expect(listMembers).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([
      true,
      false
    ]);
  });

  it.each(["add", "update", "remove"] as const)(
    "silently handles an unmounted %s mutation rejection",
    async (action) => {
      const mutation = deferred<never>();
      const listMembers = vi.fn().mockResolvedValue([member(), editorMember()]);
      const onChanged = vi.fn();
      const onBusyChange = vi.fn();
      const onSessionExpired = vi.fn();
      const addMember = vi.fn<ProjectsClient["addMember"]>(
        () => mutation.promise
      );
      const updateMember = vi.fn<ProjectsClient["updateMember"]>(
        () => mutation.promise
      );
      const removeMember = vi.fn<ProjectsClient["removeMember"]>(
        () => mutation.promise
      );
      const view = renderPanel(
        createProjectsClientStub({
          addMember,
          listMembers,
          removeMember,
          updateMember
        }),
        { onBusyChange, onChanged, onSessionExpired }
      );
      await screen.findByText("示例负责人");

      if (action === "add") {
        await searchAndSelectCandidate();
        fireEvent.change(screen.getByLabelText("新成员角色"), {
          target: { value: "VIEWER" }
        });
        fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
        if (action === "update") {
          fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));
        } else {
          fireEvent.click(screen.getByRole("button", { name: "移除成员" }));
          fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
        }
      }

      const selectedMutation =
        action === "add"
          ? addMember
          : action === "update"
            ? updateMember
            : removeMember;
      expect(selectedMutation).toHaveBeenCalledOnce();
      await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
      view.unmount();
      mutation.reject(
        new ApiClientError(401, "SESSION_EXPIRED", "unmounted internal")
      );
      await mutation.promise.catch(() => undefined);
      await Promise.resolve();

      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(listMembers).toHaveBeenCalledOnce();
      expect(onChanged).not.toHaveBeenCalled();
      expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([
        true,
        false
      ]);
      expect(view.container).toBeEmptyDOMElement();
    }
  );

  it.each(["resolve", "reject"] as const)(
    "skips onChanged when unmounted during a member refresh that later %ss",
    async (completion) => {
      const refreshedMembers = deferred<ProjectMemberView[]>();
      const listMembers = vi
        .fn<ProjectsClient["listMembers"]>()
        .mockResolvedValueOnce([member()])
        .mockImplementationOnce(() => refreshedMembers.promise);
      const onChanged = vi.fn();
      const onBusyChange = vi.fn();
      const view = renderPanel(
        createProjectsClientStub({
          addMember: vi.fn().mockResolvedValue(editorMember()),
          listMembers
        }),
        { onBusyChange, onChanged }
      );
      await screen.findByText("示例负责人");
      await searchAndSelectCandidate();
      fireEvent.change(screen.getByLabelText("新成员角色"), {
        target: { value: "VIEWER" }
      });
      fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

      await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
      view.unmount();
      if (completion === "resolve") {
        refreshedMembers.resolve([member(), editorMember()]);
      } else {
        refreshedMembers.reject(
          new ApiClientError(0, "NETWORK_ERROR", "unmounted refresh internal")
        );
      }
      await refreshedMembers.promise.catch(() => undefined);
      await Promise.resolve();

      expect(onChanged).not.toHaveBeenCalled();
      expect(listMembers).toHaveBeenCalledTimes(2);
      expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([
        true,
        false
      ]);
      expect(view.container).toBeEmptyDOMElement();
    }
  );

  it("edits all four member fields and protects the only owner", async () => {
    renderPanel(
      createProjectsClientStub({
        listMembers: vi.fn().mockResolvedValue([member()])
      })
    );
    const manageButton = await screen.findByRole("button", {
      name: "管理示例负责人"
    });
    fireEvent.click(manageButton);

    const dialog = screen.getByRole("dialog", { name: "管理示例负责人" });
    expect(screen.getByLabelText("成员角色")).toHaveValue("OWNER");
    expect(screen.getByLabelText("职位")).toHaveValue("项目经理");
    expect(screen.getByLabelText("电话")).toHaveValue("13800000000");
    expect(screen.getByLabelText("备注")).toHaveValue("现场负责");
    expect(
      within(dialog).getByRole("option", { name: "协作编辑" })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("option", { name: "只读成员" })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "移除成员" })
    ).toBeDisabled();
    expect(dialog).toHaveTextContent("项目必须保留至少一名负责人");
  });

  it("submits one member update, reloads once, and awaits onChanged", async () => {
    const mutation = deferred<ProjectMemberView>();
    const changed = deferred<void>();
    const updateMember = vi.fn(() => mutation.promise);
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember()]);
    const onChanged = vi.fn(() => changed.promise);
    renderPanel(createProjectsClientStub({ listMembers, updateMember }), {
      onChanged
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "管理协作成员" })
    );

    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.change(screen.getByLabelText("职位"), {
      target: { value: "资料员" }
    });
    fireEvent.change(screen.getByLabelText("电话"), {
      target: { value: "13700000000" }
    });
    fireEvent.change(screen.getByLabelText("备注"), {
      target: { value: "只读协助" }
    });
    const save = screen.getByRole("button", { name: "保存成员修改" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(updateMember).toHaveBeenCalledOnce();
    expect(updateMember).toHaveBeenCalledWith(projectId, editorMemberId, {
      memberRole: "VIEWER",
      jobTitle: "资料员",
      phone: "13700000000",
      remark: "只读协助"
    });
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "保存中" })
    ).toBeDisabled();
    mutation.resolve(editorMember());
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledOnce();
    changed.resolve();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "成员信息已更新"
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses an independent alertdialog for one confirmed removal and complete refresh", async () => {
    const mutation = deferred<void>();
    const removeMember = vi.fn(() => mutation.promise);
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member()]);
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderPanel(createProjectsClientStub({ listMembers, removeMember }), {
      onChanged
    });
    const manageButton = await screen.findByRole("button", {
      name: "管理协作成员"
    });
    fireEvent.click(manageButton);
    fireEvent.click(screen.getByRole("button", { name: "移除成员" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const alertDialog = screen.getByRole("alertdialog", {
      name: "移除协作成员"
    });
    expect(removeMember).not.toHaveBeenCalled();
    const confirm = within(alertDialog).getByRole("button", {
      name: "确认移除"
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(removeMember).toHaveBeenCalledOnce();
    expect(removeMember).toHaveBeenCalledWith(projectId, editorMemberId);
    expect(
      within(alertDialog).getByRole("button", { name: "移除中" })
    ).toBeDisabled();
    expect(
      within(alertDialog).getByRole("button", { name: "取消移除" })
    ).toBeDisabled();
    fireEvent.keyDown(alertDialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    mutation.resolve();

    expect(await screen.findByRole("status")).toHaveTextContent("成员已移除");
    expect(listMembers).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByText("协作成员")).not.toBeInTheDocument();
  });

  it("focuses the stable members region after a successful removal", async () => {
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member()]);
    renderPanel(
      createProjectsClientStub({
        listMembers,
        removeMember: vi.fn().mockResolvedValue(undefined)
      })
    );
    const manageButton = await screen.findByRole("button", {
      name: "管理协作成员"
    });
    manageButton.focus();
    fireEvent.click(manageButton);
    fireEvent.click(screen.getByRole("button", { name: "移除成员" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));

    expect(await screen.findByRole("status")).toHaveTextContent("成员已移除");
    expect(screen.getByRole("region", { name: "项目成员" })).toHaveFocus();
    expect(screen.queryByText("协作成员")).not.toBeInTheDocument();
  });

  it("moves focus into dialogs, traps Tab, handles Escape, and restores the management trigger", async () => {
    renderPanel(createProjectsClientStub());
    const manageButton = await screen.findByRole("button", {
      name: "管理协作成员"
    });
    manageButton.focus();
    fireEvent.click(manageButton);

    const dialog = screen.getByRole("dialog");
    const roleSelect = screen.getByLabelText("成员角色");
    const save = screen.getByRole("button", { name: "保存成员修改" });
    expect(roleSelect).toHaveFocus();
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(roleSelect).toHaveFocus();
    roleSelect.focus();
    fireEvent.keyDown(roleSelect, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(manageButton).toHaveFocus();

    fireEvent.click(manageButton);
    fireEvent.click(screen.getByRole("button", { name: "移除成员" }));
    const alertDialog = screen.getByRole("alertdialog");
    const cancel = within(alertDialog).getByRole("button", {
      name: "取消移除"
    });
    const confirm = within(alertDialog).getByRole("button", {
      name: "确认移除"
    });
    expect(cancel).toHaveFocus();
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(alertDialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(manageButton).toHaveFocus();
  });

  it("keeps pending edit cancellation and Escape disabled", async () => {
    const mutation = deferred<ProjectMemberView>();
    renderPanel(
      createProjectsClientStub({ updateMember: vi.fn(() => mutation.promise) })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "管理协作成员" })
    );
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    mutation.resolve(editorMember());
  });

  it("maps LAST_OWNER_REQUIRED even when local members are stale", async () => {
    const updateMember = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(409, "LAST_OWNER_REQUIRED", "last owner internal")
      );
    renderPanel(createProjectsClientStub({ updateMember }));
    fireEvent.click(
      await screen.findByRole("button", { name: "管理协作成员" })
    );
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "项目必须保留至少一名负责人"
    );
    expect(screen.queryByText("last owner internal")).not.toBeInTheDocument();
  });

  it.each([
    [401, "SESSION_EXPIRED", "callback"],
    [404, "MEMBER_NOT_FOUND", "成员不存在或您无权操作"],
    [403, "FORBIDDEN", "您没有管理项目成员的权限"]
  ])(
    "handles member mutation HTTP %s safely",
    async (status, code, expected) => {
      const onSessionExpired = vi.fn();
      const updateMember = vi
        .fn()
        .mockRejectedValue(
          new ApiClientError(status, code, "内部 mutation 信息")
        );
      renderPanel(createProjectsClientStub({ updateMember }), {
        onSessionExpired
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "管理协作成员" })
      );
      fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

      if (expected === "callback") {
        await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
        expect(
          within(screen.getByRole("dialog")).queryByRole("alert")
        ).not.toBeInTheDocument();
      } else {
        expect(
          await within(screen.getByRole("dialog")).findByRole("alert")
        ).toHaveTextContent(expected);
      }
      expect(screen.queryByText("内部 mutation 信息")).not.toBeInTheDocument();
    }
  );
});

describe("ProjectDetailView member integration", () => {
  it("focuses the members region after self-demotion removes management controls", async () => {
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockResolvedValueOnce(details({ canManageMembers: false }));
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([
        member(),
        editorMember({ memberRole: "VIEWER" })
      ]);
    render(
      <ProjectDetailView
        client={createProjectsClientStub({
          getProject,
          listMembers,
          updateMember: vi
            .fn()
            .mockResolvedValue(editorMember({ memberRole: "VIEWER" }))
        })}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    const manageButton = await screen.findByRole("button", {
      name: "管理协作成员"
    });
    manageButton.focus();
    fireEvent.click(manageButton);
    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "成员信息已更新"
    );
    expect(
      screen.queryByRole("button", { name: /^管理/u })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目成员" })).toHaveFocus();
  });

  it("blocks returning during add and refreshes the project list before leaving", async () => {
    const addResponse = deferred<Response>();
    const addedMember = member(
      {
        id: crypto.randomUUID(),
        userId: candidateUserId,
        memberRole: "VIEWER",
        jobTitle: "",
        phone: "",
        remark: ""
      },
      {
        id: candidateUserId,
        username: "candidate.user",
        displayName: "候选成员"
      }
    );
    let listCalls = 0;
    let memberCalls = 0;
    let detailCalls = 0;
    let addCalls = 0;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (url.pathname === "/api/v1/projects" && method === "GET") {
          listCalls += 1;
          return jsonResponse({
            items: [
              {
                project: project({
                  name: listCalls === 1 ? "示例-成员闭环" : "示例-列表已刷新"
                }),
                owners: [user()]
              }
            ],
            page: 1,
            pageSize: 20,
            total: 1
          });
        }
        if (
          url.pathname === `/api/v1/projects/${projectId}/member-candidates`
        ) {
          return jsonResponse([candidate()]);
        }
        if (url.pathname === `/api/v1/projects/${projectId}/members`) {
          if (method === "POST") {
            addCalls += 1;
            return addResponse.promise;
          }
          memberCalls += 1;
          return jsonResponse(
            memberCalls === 1 ? [member()] : [member(), addedMember]
          );
        }
        if (url.pathname === `/api/v1/projects/${projectId}`) {
          detailCalls += 1;
          return jsonResponse(
            details({
              canManageMembers: true
            })
          );
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }
    ) as typeof fetch;
    render(
      <ProjectsView
        apiBaseUrl="http://localhost/api"
        fetchImpl={fetchImpl}
        onOpenProject={vi.fn()}
        onSessionExpired={vi.fn()}
        sessionUser={{ userId: ownerUserId, role: "USER" }}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "示例-成员闭环" })
    );
    await screen.findByText("示例负责人");
    await searchAndSelectCandidate();
    fireEvent.change(screen.getByLabelText("新成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

    const backButton = screen.getByRole("button", { name: "返回项目列表" });
    expect(backButton).toBeDisabled();
    fireEvent.click(backButton);
    expect(
      screen.getByRole("heading", { name: "示例-成员闭环" })
    ).toBeInTheDocument();
    addResponse.resolve(jsonResponse(addedMember, 201));

    await waitFor(() => expect(backButton).toBeEnabled());
    expect(memberCalls).toBe(2);
    expect(detailCalls).toBe(2);
    expect(addCalls).toBe(1);
    fireEvent.click(backButton);

    expect(
      await screen.findByRole("button", { name: "示例-列表已刷新" })
    ).toBeInTheDocument();
    expect(listCalls).toBe(2);
    expect(addCalls).toBe(1);
  });

  it("keeps details and audit visible when background refresh fails, then retries refresh only", async () => {
    const refreshedDetails: ProjectDetails = {
      project: project({ name: "示例-刷新后项目" }),
      permissions: permissions()
    };
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockRejectedValueOnce(
        new ApiClientError(0, "NETWORK_ERROR", "detail refresh offline")
      )
      .mockResolvedValueOnce(refreshedDetails);
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember({ memberRole: "VIEWER" })])
      .mockResolvedValueOnce([
        member(),
        editorMember({ memberRole: "VIEWER" })
      ]);
    const listAuditEvents = vi
      .fn<ProjectsClient["listAuditEvents"]>()
      .mockResolvedValueOnce(auditPage("旧审计"))
      .mockResolvedValueOnce(auditPage("新审计"));
    const updateMember = vi
      .fn()
      .mockResolvedValue(editorMember({ memberRole: "VIEWER" }));
    const client = createProjectsClientStub({
      getProject,
      listAuditEvents,
      listMembers,
      updateMember
    });
    render(
      <ProjectDetailView
        client={client}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    expect(
      await screen.findByRole("heading", { name: "示例-成员闭环" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    expect(await screen.findByText(/旧审计/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "成员信息已更新，但项目状态刷新失败"
    );
    expect(
      screen.getByRole("heading", { name: "示例-成员闭环" })
    ).toBeInTheDocument();
    expect(screen.getByText(/旧审计/u)).toBeInTheDocument();
    expect(screen.getByText("示例负责人")).toBeInTheDocument();
    expect(
      screen.queryByText("项目详情加载失败，请重试")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试刷新项目状态" }));

    expect(
      await screen.findByRole("heading", { name: "示例-刷新后项目" })
    ).toBeInTheDocument();
    expect(await screen.findByText(/新审计/u)).toBeInTheDocument();
    expect(screen.queryByText(/旧审计/u)).not.toBeInTheDocument();
    expect(updateMember).toHaveBeenCalledOnce();
    expect(listMembers).toHaveBeenCalledTimes(3);
    expect(getProject).toHaveBeenCalledTimes(3);
    expect(listAuditEvents).toHaveBeenCalledTimes(2);
    expect(listAuditEvents).toHaveBeenLastCalledWith(projectId, 1);
  });

  it("keeps old audit items when replacement fails and replaces them after audit retry", async () => {
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockResolvedValueOnce(details());
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember()]);
    const listAuditEvents = vi
      .fn<ProjectsClient["listAuditEvents"]>()
      .mockResolvedValueOnce(auditPage("旧审计"))
      .mockRejectedValueOnce(
        new ApiClientError(0, "NETWORK_ERROR", "audit refresh offline")
      )
      .mockResolvedValueOnce(auditPage("新审计"));
    const updateMember = vi.fn().mockResolvedValue(editorMember());
    render(
      <ProjectDetailView
        client={createProjectsClientStub({
          getProject,
          listAuditEvents,
          listMembers,
          updateMember
        })}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    await screen.findByText("示例负责人");
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    expect(await screen.findByText(/旧审计/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    const auditSection = screen
      .getByRole("heading", { name: "审计记录" })
      .closest("section");
    expect(auditSection).not.toBeNull();
    expect(await within(auditSection!).findByRole("alert")).toHaveTextContent(
      "审计记录加载失败，请重试"
    );
    expect(within(auditSection!).getByText(/旧审计/u)).toBeInTheDocument();
    expect(screen.queryByText(/新审计/u)).not.toBeInTheDocument();

    fireEvent.click(
      within(auditSection!).getByRole("button", {
        name: "重试加载审计记录"
      })
    );

    expect(await screen.findByText(/新审计/u)).toBeInTheDocument();
    expect(screen.queryByText(/旧审计/u)).not.toBeInTheDocument();
    expect(updateMember).toHaveBeenCalledOnce();
    expect(listMembers).toHaveBeenCalledTimes(2);
    expect(getProject).toHaveBeenCalledTimes(2);
    expect(listAuditEvents).toHaveBeenCalledTimes(3);
  });

  it("lets deferred audit load-more finish when background detail refresh fails", async () => {
    const moreAudit = deferred<ProjectAuditPage>();
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockRejectedValueOnce(
        new ApiClientError(0, "NETWORK_ERROR", "detail refresh offline")
      );
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember()]);
    const listAuditEvents = vi
      .fn<ProjectsClient["listAuditEvents"]>()
      .mockResolvedValueOnce(auditPage("旧审计", 1, 2))
      .mockImplementationOnce(() => moreAudit.promise);
    render(
      <ProjectDetailView
        client={createProjectsClientStub({
          getProject,
          listAuditEvents,
          listMembers,
          updateMember: vi.fn().mockResolvedValue(editorMember())
        })}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    await screen.findByText("示例负责人");
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    expect(await screen.findByText(/旧审计/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(screen.getByRole("button", { name: "加载中" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));
    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2));
    moreAudit.resolve(auditPage("加载更多审计", 2, 2));

    expect(await screen.findByText(/加载更多审计/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加载中" })
    ).not.toBeInTheDocument();
    expect(listAuditEvents).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, "FORBIDDEN", "您没有查看此项目的权限"],
    [404, "PROJECT_NOT_FOUND", "项目不存在或您无权查看"]
  ])(
    "enters a safe state and clears audit when background detail refresh returns HTTP %s",
    async (status, code, message) => {
      const getProject = vi
        .fn<ProjectsClient["getProject"]>()
        .mockResolvedValueOnce(details())
        .mockRejectedValueOnce(
          new ApiClientError(status, code, "background detail internal")
        );
      const listMembers = vi
        .fn<ProjectsClient["listMembers"]>()
        .mockResolvedValueOnce([member(), editorMember()])
        .mockResolvedValueOnce([member(), editorMember()]);
      const client = createProjectsClientStub({
        getProject,
        listMembers,
        listAuditEvents: vi.fn().mockResolvedValue(auditPage("旧审计")),
        updateMember: vi.fn().mockResolvedValue(editorMember())
      });
      render(
        <ProjectDetailView
          client={client}
          onBack={vi.fn()}
          onSessionExpired={vi.fn()}
          projectId={projectId}
        />
      );

      await screen.findByText("示例负责人");
      fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
      expect(await screen.findByText(/旧审计/u)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
      fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByText(/旧审计/u)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "审计记录" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("background detail internal")
      ).not.toBeInTheDocument();
    }
  );

  it("notifies session expiry without replacing current details on background refresh 401", async () => {
    const onSessionExpired = vi.fn();
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockRejectedValueOnce(
        new ApiClientError(
          401,
          "SESSION_EXPIRED",
          "background session internal"
        )
      );
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([member(), editorMember()]);
    render(
      <ProjectDetailView
        client={createProjectsClientStub({
          getProject,
          listMembers,
          updateMember: vi.fn().mockResolvedValue(editorMember())
        })}
        onBack={vi.fn()}
        onSessionExpired={onSessionExpired}
        projectId={projectId}
      />
    );

    await screen.findByText("示例负责人");
    fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("heading", { name: "示例-成员闭环" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("background session internal")
    ).not.toBeInTheDocument();
  });

  it("always renders members and refreshes permissions plus open audit page one after a mutation", async () => {
    const oldAudit = deferred<ProjectAuditPage>();
    const currentAudit = deferred<ProjectAuditPage>();
    const getProject = vi
      .fn<ProjectsClient["getProject"]>()
      .mockResolvedValueOnce(details())
      .mockResolvedValueOnce(details({ canManageMembers: false }));
    const listMembers = vi
      .fn<ProjectsClient["listMembers"]>()
      .mockResolvedValueOnce([member(), editorMember()])
      .mockResolvedValueOnce([
        member(),
        editorMember({ memberRole: "VIEWER" })
      ]);
    const listAuditEvents = vi
      .fn<ProjectsClient["listAuditEvents"]>()
      .mockImplementationOnce(() => oldAudit.promise)
      .mockImplementationOnce(() => currentAudit.promise);
    const updateMember = vi
      .fn()
      .mockResolvedValue(editorMember({ memberRole: "VIEWER" }));
    const client = createProjectsClientStub({
      getProject,
      listAuditEvents,
      listMembers,
      updateMember
    });
    render(
      <ProjectDetailView
        client={client}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    expect(await screen.findByText("示例负责人")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看审计记录" }));
    expect(listAuditEvents).toHaveBeenCalledWith(projectId, 1);
    fireEvent.click(screen.getByRole("button", { name: "管理协作成员" }));
    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "VIEWER" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存成员修改" }));

    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledTimes(2));
    expect(listAuditEvents).toHaveBeenLastCalledWith(projectId, 1);
    currentAudit.resolve(auditPage("新审计"));
    expect(await screen.findByText(/新审计/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^管理/u })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listMembers).toHaveBeenCalledTimes(2);

    oldAudit.resolve(auditPage("旧审计"));
    await oldAudit.promise;
    await Promise.resolve();
    expect(screen.queryByText(/旧审计/u)).not.toBeInTheDocument();
    expect(screen.getByText(/新审计/u)).toBeInTheDocument();
  });

  it("keeps archived read-only member records visible", async () => {
    const client = createProjectsClientStub({
      getProject: vi.fn().mockResolvedValue(
        details({
          canEdit: false,
          canManageMembers: false,
          canChangeLifecycle: false,
          canReadAudit: false
        })
      ),
      listMembers: vi
        .fn()
        .mockResolvedValue([
          member({}, { accountStatus: "DISABLED" }),
          { member: editorMember().member, user: null }
        ])
    });
    client.getProject = vi.fn().mockResolvedValue({
      project: project({ lifecycle: "ARCHIVED" }),
      permissions: permissions({
        canEdit: false,
        canManageMembers: false,
        canChangeLifecycle: false,
        canReadAudit: false
      })
    });
    render(
      <ProjectDetailView
        client={client}
        onBack={vi.fn()}
        onSessionExpired={vi.fn()}
        projectId={projectId}
      />
    );

    expect(await screen.findByText("示例负责人")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText("已归档")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^管理/u })
    ).not.toBeInTheDocument();
  });
});
