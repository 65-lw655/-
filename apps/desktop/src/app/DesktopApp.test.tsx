// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import type { ProjectDetails, ProjectPage } from "@project-online/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopApp } from "./DesktopApp.js";
import type { DesktopBridge, LocalStatus } from "../platform/desktop-bridge.js";

const projectId = "00000000-0000-4000-8000-0000000000f5";

function projectDetails(name = "示例-离线本地项目"): ProjectDetails {
  return {
    project: {
      id: projectId,
      name,
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
    syncState: name === "示例-已本地编辑项目" ? "PENDING" : "SYNCED"
  };
}

function projectPage(details = projectDetails()): ProjectPage {
  return {
    items: [
      {
        project: details.project,
        ownerLabels: ["本机缓存"],
        syncState: details.syncState
      }
    ],
    page: 1,
    pageSize: 20,
    total: 1
  };
}

function bridgeStub(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  let details = projectDetails();
  let status: LocalStatus = {
    deviceId: "00000000-0000-4000-8000-0000000000d5",
    pendingCount: 0
  };

  return {
    listProjects: vi
      .fn()
      .mockImplementation(() => Promise.resolve(projectPage(details))),
    getProject: vi.fn().mockImplementation(() => Promise.resolve(details)),
    updateProject: vi.fn().mockImplementation(async (_projectId, input) => {
      details = projectDetails(input.name);
      status = { ...status, pendingCount: 1 };
      return details;
    }),
    getLocalStatus: vi.fn().mockImplementation(() => Promise.resolve(status)),
    credentialStatus: vi.fn().mockResolvedValue("MISSING"),
    saveCredential: vi.fn().mockResolvedValue("PRESENT"),
    deleteCredential: vi.fn().mockResolvedValue("MISSING"),
    ...overrides
  };
}

describe("DesktopApp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts from local status and project list without checking fetch", async () => {
    const bridge = bridgeStub();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled"));

    render(<DesktopApp bridge={bridge} />);

    expect(screen.getByRole("heading", { name: "本机项目" })).toBeVisible();
    expect(await screen.findByText("示例-离线本地项目")).toBeVisible();
    expect(screen.getByText("本机数据已就绪")).toBeVisible();
    expect(screen.getByText("M4 暂不自动上传")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a local empty state for an empty cache", async () => {
    const bridge = bridgeStub({
      listProjects: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0
      })
    });

    render(<DesktopApp bridge={bridge} />);

    expect(await screen.findByText("暂无项目")).toBeVisible();
    expect(screen.queryByText("项目加载失败，请重试")).not.toBeInTheDocument();
  });

  it("opens cached detail and refreshes pending count after saving", async () => {
    const bridge = bridgeStub();

    render(<DesktopApp bridge={bridge} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "示例-离线本地项目" })
    );
    expect(
      await screen.findByRole("heading", { name: "示例-离线本地项目" })
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "编辑项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "示例-已本地编辑项目" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到本机" }));

    expect(
      await screen.findByRole("heading", { name: "示例-已本地编辑项目" })
    ).toBeVisible();
    expect(screen.getByText("1 项修改待同步")).toBeVisible();
    expect(bridge.updateProject).toHaveBeenCalledTimes(1);
  });

  it("remounts against the same bridge state with the edited local value", async () => {
    const bridge = bridgeStub();
    const { unmount } = render(<DesktopApp bridge={bridge} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "示例-离线本地项目" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "编辑项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "示例-已本地编辑项目" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到本机" }));
    await screen.findByRole("heading", { name: "示例-已本地编辑项目" });

    unmount();
    render(<DesktopApp bridge={bridge} />);

    expect(await screen.findByText("示例-已本地编辑项目")).toBeVisible();
    expect(screen.getByText("1 项修改待同步")).toBeVisible();
  });

  it("blocks the app when local initialization fails", async () => {
    const bridge = bridgeStub({
      getLocalStatus: vi.fn().mockRejectedValue(new Error("open failed"))
    });

    render(<DesktopApp bridge={bridge} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "本机数据初始化失败"
    );
    expect(screen.queryByText("保存到本机")).not.toBeInTheDocument();
    await waitFor(() => expect(bridge.listProjects).not.toHaveBeenCalled());
  });
});
