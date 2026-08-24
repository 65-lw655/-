import type { ProjectInput, ProjectListFilters } from "@project-online/domain";
import type { ProjectDetails, ProjectPage } from "@project-online/ui";
import { describe, expect, it, vi } from "vitest";

import { createDesktopBridge, type Invoke } from "./desktop-bridge.js";

function invokeReturning(value: unknown): {
  invoke: Invoke;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn<
    (command: string, args?: Record<string, unknown>) => Promise<unknown>
  >(() => Promise.resolve(value));
  return {
    invoke: <T>(command: string, args?: Record<string, unknown>) =>
      (args === undefined ? spy(command) : spy(command, args)) as Promise<T>,
    spy
  };
}

function projectPage(): ProjectPage {
  return {
    items: [
      {
        project: projectDetails().project,
        ownerLabels: [],
        syncState: "PENDING"
      }
    ],
    page: 2,
    pageSize: 10,
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

describe("desktop bridge", () => {
  it("invokes list_local_projects with camelCase filters", async () => {
    const filters: ProjectListFilters = {
      page: 2,
      pageSize: 10,
      query: "示例",
      year: 2026,
      status: "施工中",
      lifecycle: "ACTIVE"
    };
    const { invoke, spy } = invokeReturning(projectPage());
    const bridge = createDesktopBridge(invoke);

    await expect(bridge.listProjects(filters)).resolves.toEqual(projectPage());

    expect(spy).toHaveBeenCalledWith("list_local_projects", { filters });
  });

  it("invokes get_local_project with projectId", async () => {
    const { invoke, spy } = invokeReturning(projectDetails());
    const bridge = createDesktopBridge(invoke);
    const projectId = "00000000-0000-4000-8000-0000000000f5";

    await expect(bridge.getProject(projectId)).resolves.toEqual(
      projectDetails()
    );

    expect(spy).toHaveBeenCalledWith("get_local_project", { projectId });
  });

  it("invokes update_local_project with projectId and input", async () => {
    const input = projectInput();
    const { invoke, spy } = invokeReturning(projectDetails());
    const bridge = createDesktopBridge(invoke);
    const projectId = "00000000-0000-4000-8000-0000000000f5";

    await expect(bridge.updateProject(projectId, input)).resolves.toEqual(
      projectDetails()
    );

    expect(spy).toHaveBeenCalledWith("update_local_project", {
      projectId,
      input
    });
  });

  it("invokes get_local_status without payload", async () => {
    const status = {
      deviceId: "00000000-0000-4000-8000-0000000000d5",
      pendingCount: 3
    };
    const { invoke, spy } = invokeReturning(status);
    const bridge = createDesktopBridge(invoke);

    await expect(bridge.getLocalStatus()).resolves.toEqual(status);

    expect(spy).toHaveBeenCalledWith("get_local_status");
  });

  it("invokes credential_status without payload", async () => {
    const { invoke, spy } = invokeReturning("MISSING");
    const bridge = createDesktopBridge(invoke);

    await expect(bridge.credentialStatus()).resolves.toBe("MISSING");

    expect(spy).toHaveBeenCalledWith("credential_status");
  });

  it("invokes save_credential with the session credential input", async () => {
    const { invoke, spy } = invokeReturning("PRESENT");
    const bridge = createDesktopBridge(invoke);
    const credential = "fictional-session-value";

    await expect(bridge.saveCredential(credential)).resolves.toBe("PRESENT");

    expect(spy).toHaveBeenCalledWith("save_credential", {
      input: { credential }
    });
  });

  it("invokes delete_credential without payload", async () => {
    const { invoke, spy } = invokeReturning("MISSING");
    const bridge = createDesktopBridge(invoke);

    await expect(bridge.deleteCredential()).resolves.toBe("MISSING");

    expect(spy).toHaveBeenCalledWith("delete_credential");
  });
});
