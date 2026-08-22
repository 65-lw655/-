// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ProjectInput, ProjectRecord } from "@project-online/domain";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../api-client.js";
import { ProjectEditorDialog } from "./ProjectEditorDialog.js";
import type {
  MemberCandidate,
  ProjectDetails,
  ProjectsClient
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

function details(value = project()): ProjectDetails {
  return {
    project: value,
    permissions: {
      canEdit: true,
      canManageMembers: true,
      canChangeLifecycle: true,
      canReadAudit: true
    }
  };
}

function createProjectsClientStub(
  overrides: Partial<ProjectsClient> = {}
): ProjectsClient {
  return {
    listProjects: vi.fn(),
    listInitialOwnerCandidates: vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        username: "owner.one",
        displayName: "首位负责人"
      }
    ]),
    createProject: vi.fn().mockResolvedValue(details()),
    getProject: vi.fn(),
    updateProject: vi.fn().mockResolvedValue(details()),
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

function validInput(): ProjectInput {
  return {
    name: "新建展馆项目",
    year: 2027,
    type: "展览展示",
    status: "施工中",
    phase: "深化设计",
    filingStatus: "待归档",
    plannedCompletionDate: null,
    actualCompletionDate: null
  };
}

function fillProjectForm(input = validInput()): void {
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: input.name }
  });
  fireEvent.change(screen.getByLabelText("年度"), {
    target: { value: String(input.year) }
  });
  fireEvent.change(screen.getByLabelText("类型"), {
    target: { value: input.type }
  });
  fireEvent.change(screen.getByLabelText("状态"), {
    target: { value: input.status }
  });
  fireEvent.change(screen.getByLabelText("阶段"), {
    target: { value: input.phase }
  });
  fireEvent.change(screen.getByLabelText("归档状态"), {
    target: { value: input.filingStatus }
  });
  fireEvent.change(screen.getByLabelText("计划完成日期"), {
    target: { value: input.plannedCompletionDate ?? "" }
  });
  fireEvent.change(screen.getByLabelText("实际完成日期"), {
    target: { value: input.actualCompletionDate ?? "" }
  });
}

function EditorHarness({ client }: { client: ProjectsClient }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        打开项目编辑器
      </button>
      {open ? (
        <ProjectEditorDialog
          client={client}
          mode="create"
          onClose={() => setOpen(false)}
          onSaved={() => undefined}
          onSessionExpired={() => undefined}
        />
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("ProjectEditorDialog", () => {
  it("moves focus into the dialog, closes on Escape, and restores its trigger", async () => {
    const triggerLabel = "打开项目编辑器";
    render(
      <StrictMode>
        <EditorHarness client={createProjectsClientStub()} />
      </StrictMode>
    );

    const trigger = screen.getByRole("button", { name: triggerLabel });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByLabelText("项目名称")).toHaveFocus()
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("loops keyboard focus within enabled dialog controls", async () => {
    const ownersRequest = deferred<MemberCandidate[]>();
    const client = createProjectsClientStub({
      listInitialOwnerCandidates: vi.fn(() => ownersRequest.promise)
    });
    render(<EditorHarness client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "打开项目编辑器" }));
    const firstControl = screen.getByLabelText("项目名称");
    const lastEnabledControl = screen.getByRole("button", { name: "取消" });
    expect(screen.getByLabelText("首位负责人")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();

    await waitFor(() => expect(firstControl).toHaveFocus());
    lastEnabledControl.focus();
    fireEvent.keyDown(lastEnabledControl, { key: "Tab" });
    expect(firstControl).toHaveFocus();

    firstControl.focus();
    fireEvent.keyDown(firstControl, { key: "Tab", shiftKey: true });
    expect(lastEnabledControl).toHaveFocus();
  });

  it("resolves initial owners from one request in StrictMode", async () => {
    const ownersRequest = deferred<MemberCandidate[]>();
    const listInitialOwnerCandidates = vi.fn(() => ownersRequest.promise);
    const client = createProjectsClientStub({ listInitialOwnerCandidates });

    render(
      <StrictMode>
        <ProjectEditorDialog
          client={client}
          mode="create"
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onSessionExpired={vi.fn()}
        />
      </StrictMode>
    );

    expect(listInitialOwnerCandidates).toHaveBeenCalledOnce();
    ownersRequest.resolve([
      {
        id: "11111111-1111-4111-8111-111111111111",
        username: "owner.one",
        displayName: "首位负责人"
      }
    ]);

    expect(
      await screen.findByRole("option", { name: "首位负责人（owner.one）" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("首位负责人")).toBeEnabled();
    expect(listInitialOwnerCandidates).toHaveBeenCalledOnce();
  });

  it("loads initial owners once in create mode and requires one", async () => {
    const client = createProjectsClientStub();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { rerender } = render(
      <ProjectEditorDialog
        client={client}
        mode="create"
        onClose={onClose}
        onSaved={onSaved}
        onSessionExpired={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "新建项目" })).toHaveAttribute(
      "aria-modal",
      "true"
    );
    expect(
      await screen.findByRole("option", { name: "首位负责人（owner.one）" })
    ).toBeInTheDocument();
    rerender(
      <ProjectEditorDialog
        client={client}
        mode="create"
        onClose={onClose}
        onSaved={onSaved}
        onSessionExpired={vi.fn()}
      />
    );
    expect(client.listInitialOwnerCandidates).toHaveBeenCalledOnce();

    fillProjectForm();
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请选择首位负责人"
    );
    expect(client.createProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("首位负责人"), {
      target: { value: "11111111-1111-4111-8111-111111111111" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    await waitFor(() =>
      expect(client.createProject).toHaveBeenCalledWith({
        project: validInput(),
        ownerUserId: "11111111-1111-4111-8111-111111111111"
      })
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses domain validation before submitting", async () => {
    const client = createProjectsClientStub();
    render(
      <ProjectEditorDialog
        client={client}
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={vi.fn()}
      />
    );
    await screen.findByLabelText("首位负责人");
    fillProjectForm({ ...validInput(), name: " ", year: 1800 });
    fireEvent.change(screen.getByLabelText("首位负责人"), {
      target: { value: "11111111-1111-4111-8111-111111111111" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    expect(
      await screen.findByText("长度必须为 1-200 个字符")
    ).toBeInTheDocument();
    expect(screen.getByText("必须为 1900-2100 的整数")).toBeInTheDocument();
    expect(client.createProject).not.toHaveBeenCalled();
  });

  it("does not load global users in edit mode and updates all eight fields", async () => {
    const existingProject = project();
    const client = createProjectsClientStub();
    const onSaved = vi.fn();
    render(
      <ProjectEditorDialog
        client={client}
        mode="edit"
        onClose={vi.fn()}
        onSaved={onSaved}
        onSessionExpired={vi.fn()}
        project={existingProject}
      />
    );

    expect(
      screen.getByRole("dialog", { name: "编辑项目" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("首位负责人")).not.toBeInTheDocument();
    expect(client.listInitialOwnerCandidates).not.toHaveBeenCalled();
    fillProjectForm({
      ...validInput(),
      plannedCompletionDate: "2027-11-10",
      actualCompletionDate: "2027-11-12"
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(client.updateProject).toHaveBeenCalledWith(existingProject.id, {
        ...validInput(),
        plannedCompletionDate: "2027-11-10",
        actualCompletionDate: "2027-11-12"
      })
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("prevents duplicate create submissions while unresolved", async () => {
    const request = deferred<ProjectDetails>();
    const createProject = vi.fn(() => request.promise);
    const client = createProjectsClientStub({ createProject });
    render(
      <ProjectEditorDialog
        client={client}
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={vi.fn()}
      />
    );
    await screen.findByRole("option", { name: "首位负责人（owner.one）" });
    fillProjectForm();
    fireEvent.change(screen.getByLabelText("首位负责人"), {
      target: { value: "11111111-1111-4111-8111-111111111111" }
    });

    const submit = screen.getByRole("button", { name: "创建项目" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(createProject).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "创建中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByLabelText("项目名称")).toBeDisabled();

    request.resolve(details());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "创建中" })
      ).not.toBeInTheDocument()
    );
  });

  it("prevents duplicate update submissions while unresolved", async () => {
    const request = deferred<ProjectDetails>();
    const updateProject = vi.fn(() => request.promise);
    const client = createProjectsClientStub({ updateProject });
    render(
      <ProjectEditorDialog
        client={client}
        mode="edit"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={vi.fn()}
        project={project()}
      />
    );
    fillProjectForm();

    const submit = screen.getByRole("button", { name: "保存修改" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(updateProject).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();

    request.resolve(details());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "保存中" })
      ).not.toBeInTheDocument()
    );
  });

  it.each(["create", "edit"] as const)(
    "ignores Escape while a %s request is pending",
    async (mode) => {
      const request = deferred<ProjectDetails>();
      const client = createProjectsClientStub(
        mode === "create"
          ? { createProject: vi.fn(() => request.promise) }
          : { updateProject: vi.fn(() => request.promise) }
      );
      const onClose = vi.fn();
      const onSaved = vi.fn();

      if (mode === "create") {
        render(
          <ProjectEditorDialog
            client={client}
            mode="create"
            onClose={onClose}
            onSaved={onSaved}
            onSessionExpired={vi.fn()}
          />
        );
        await screen.findByRole("option", { name: "首位负责人（owner.one）" });
        fillProjectForm();
        fireEvent.change(screen.getByLabelText("首位负责人"), {
          target: { value: "11111111-1111-4111-8111-111111111111" }
        });
        fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
        expect(client.createProject).toHaveBeenCalledOnce();
      } else {
        render(
          <ProjectEditorDialog
            client={client}
            mode="edit"
            onClose={onClose}
            onSaved={onSaved}
            onSessionExpired={vi.fn()}
            project={project()}
          />
        );
        fillProjectForm();
        fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
        expect(client.updateProject).toHaveBeenCalledOnce();
      }

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      request.resolve(details());
      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(onClose).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ["create", "resolve"],
    ["edit", "resolve"],
    ["create", "session-reject"],
    ["edit", "generic-reject"]
  ] as const)(
    "ignores a stale %s request after external unmount when it %s",
    async (mode, completion) => {
      const request = deferred<ProjectDetails>();
      const client = createProjectsClientStub(
        mode === "create"
          ? { createProject: vi.fn(() => request.promise) }
          : { updateProject: vi.fn(() => request.promise) }
      );
      const onClose = vi.fn();
      const onSaved = vi.fn();
      const onSessionExpired = vi.fn();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const rendered =
        mode === "create"
          ? render(
              <ProjectEditorDialog
                client={client}
                mode="create"
                onClose={onClose}
                onSaved={onSaved}
                onSessionExpired={onSessionExpired}
              />
            )
          : render(
              <ProjectEditorDialog
                client={client}
                mode="edit"
                onClose={onClose}
                onSaved={onSaved}
                onSessionExpired={onSessionExpired}
                project={project()}
              />
            );

      if (mode === "create") {
        await screen.findByRole("option", { name: "首位负责人（owner.one）" });
        fillProjectForm();
        fireEvent.change(screen.getByLabelText("首位负责人"), {
          target: { value: "11111111-1111-4111-8111-111111111111" }
        });
        fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
        expect(client.createProject).toHaveBeenCalledOnce();
      } else {
        fillProjectForm();
        fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
        expect(client.updateProject).toHaveBeenCalledOnce();
      }

      rendered.unmount();
      await act(async () => {
        if (completion === "resolve") {
          request.resolve(details());
        } else if (completion === "session-reject") {
          request.reject(
            new ApiClientError(401, "SESSION_EXPIRED", "fictional expiry")
          );
        } else {
          request.reject(new Error("fictional request failure"));
        }
        await request.promise.catch(() => undefined);
        await Promise.resolve();
      });

      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    }
  );

  it("shows permission feedback and reports session expiry", async () => {
    const onSessionExpired = vi.fn();
    const client = createProjectsClientStub({
      updateProject: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiClientError(403, "FORBIDDEN", "服务端拒绝编辑")
        )
        .mockRejectedValueOnce(
          new ApiClientError(401, "SESSION_EXPIRED", "会话失效")
        )
    });
    render(
      <ProjectEditorDialog
        client={client}
        mode="edit"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={onSessionExpired}
        project={project()}
      />
    );
    fillProjectForm();

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "您没有编辑项目的权限"
    );
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
