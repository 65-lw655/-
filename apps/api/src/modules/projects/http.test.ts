import { createHmac, randomUUID } from "node:crypto";

import type { ProjectInput, ProjectRecord } from "@project-online/domain";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../app.js";
import type { ApiConfig } from "../../config.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { AuthService } from "../auth/auth-service.js";
import type { PasswordHasher } from "../auth/password.js";
import { UserService } from "../users/user-service.js";
import type {
  MemberCandidate,
  MemberService,
  ProjectMemberView
} from "./member-service.js";
import { ProjectServiceError } from "./project-service-error.js";
import type {
  ProjectAuditPage,
  ProjectDetails,
  ProjectPage,
  ProjectService
} from "./project-service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const ownerUserId = "33333333-3333-4333-8333-333333333333";
const candidateUserId = "44444444-4444-4444-8444-444444444444";

const projectInput: ProjectInput = {
  name: "虚构展陈项目",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

const project: ProjectRecord = {
  ...projectInput,
  id: projectId,
  lifecycle: "ACTIVE",
  createdAt: "2026-08-14T08:00:00.000Z",
  createdBy: ownerUserId,
  updatedAt: "2026-08-15T09:00:00.000Z",
  updatedBy: ownerUserId,
  revision: 2,
  commitSequence: 7,
  archivedAt: null,
  archivedBy: null
};

const owner = {
  id: ownerUserId,
  username: "owner.example",
  displayName: "虚构负责人",
  accountStatus: "ACTIVE"
} as const;

const projectDetails: ProjectDetails = {
  project,
  permissions: {
    canEdit: true,
    canManageMembers: true,
    canChangeLifecycle: true,
    canReadAudit: true
  }
};

const projectPage: ProjectPage = {
  items: [{ project, owners: [owner] }],
  page: 2,
  pageSize: 1,
  total: 3
};

const memberView: ProjectMemberView = {
  member: {
    id: memberId,
    projectId,
    userId: ownerUserId,
    memberRole: "OWNER",
    jobTitle: "项目经理",
    phone: "000-0000",
    remark: "虚构成员",
    createdAt: "2026-08-14T08:00:00.000Z",
    createdBy: ownerUserId,
    updatedAt: "2026-08-15T09:00:00.000Z",
    updatedBy: ownerUserId
  },
  user: owner
};

const candidate: MemberCandidate = {
  id: candidateUserId,
  username: "candidate.example",
  displayName: "虚构候选人"
};

const auditPage: ProjectAuditPage = {
  items: [
    {
      event: {
        id: "55555555-5555-4555-8555-555555555555",
        projectId,
        commitSequence: 7,
        eventType: "PROJECT_UPDATED",
        actorUserId: ownerUserId,
        targetType: "PROJECT",
        targetId: projectId,
        changeSummary: {
          fields: [
            "name",
            "year",
            "type",
            "status",
            "phase",
            "filingStatus",
            "plannedCompletionDate",
            "actualCompletionDate",
            "lifecycle",
            "memberRole",
            "jobTitle",
            "phone",
            "remark"
          ],
          before: {
            name: "虚构旧项目",
            year: "2025",
            type: "旧类型",
            status: "深化中",
            phase: "旧阶段",
            filingStatus: "待报建",
            plannedCompletionDate: null,
            actualCompletionDate: null,
            lifecycle: "ACTIVE",
            memberRole: "VIEWER"
          },
          after: {
            name: "虚构展陈项目",
            year: "2026",
            type: "展览展示",
            status: "施工中",
            phase: "现场实施",
            filingStatus: "无需报建",
            plannedCompletionDate: "2026-12-31",
            actualCompletionDate: null,
            lifecycle: "ACTIVE",
            memberRole: "OWNER"
          }
        },
        occurredAt: "2026-08-15T09:00:00.000Z"
      },
      actor: owner
    }
  ],
  page: 3,
  pageSize: 100,
  total: 201
};

type ProjectServiceStub = Pick<
  ProjectService,
  | "listProjects"
  | "createProject"
  | "getProject"
  | "updateProject"
  | "archiveProject"
  | "restoreProject"
  | "listAuditEvents"
>;

type MemberServiceStub = Pick<
  MemberService,
  | "listMembers"
  | "searchCandidates"
  | "addMember"
  | "updateMember"
  | "removeMember"
>;

function runtimePassword(): string {
  return `${randomUUID()}Aa1!`;
}

function createHasher(): PasswordHasher {
  const key = randomUUID();
  const encode = (password: string) =>
    createHmac("sha256", key).update(password).digest("base64url");
  return {
    hash: async (password) => encode(password),
    verify: async (password, encoded) => encode(password) === encoded
  };
}

async function createProjectsHttpHarness() {
  const store = new MemoryAuthStateStore();
  const passwordHasher = createHasher();
  const authService = new AuthService(
    store,
    await passwordHasher.hash(runtimePassword()),
    { passwordHasher }
  );
  const userService = new UserService(store, { passwordHasher });
  const projectService = {
    listProjects: vi
      .fn<ProjectService["listProjects"]>()
      .mockResolvedValue(projectPage),
    createProject: vi
      .fn<ProjectService["createProject"]>()
      .mockResolvedValue(projectDetails),
    getProject: vi
      .fn<ProjectService["getProject"]>()
      .mockResolvedValue(projectDetails),
    updateProject: vi
      .fn<ProjectService["updateProject"]>()
      .mockResolvedValue(projectDetails),
    archiveProject: vi
      .fn<ProjectService["archiveProject"]>()
      .mockResolvedValue(projectDetails),
    restoreProject: vi
      .fn<ProjectService["restoreProject"]>()
      .mockResolvedValue(projectDetails),
    listAuditEvents: vi
      .fn<ProjectService["listAuditEvents"]>()
      .mockResolvedValue(auditPage)
  } satisfies ProjectServiceStub;
  const memberService = {
    listMembers: vi
      .fn<MemberService["listMembers"]>()
      .mockResolvedValue([memberView]),
    searchCandidates: vi
      .fn<MemberService["searchCandidates"]>()
      .mockResolvedValue([candidate]),
    addMember: vi
      .fn<MemberService["addMember"]>()
      .mockResolvedValue(memberView),
    updateMember: vi
      .fn<MemberService["updateMember"]>()
      .mockResolvedValue(memberView),
    removeMember: vi
      .fn<MemberService["removeMember"]>()
      .mockResolvedValue(undefined)
  } satisfies MemberServiceStub;
  const close = vi.fn(async () => undefined);
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 3000,
    environment: "test",
    webOrigin: "https://web.example.test",
    authStorePath: ".local-data/auth-store.json"
  };
  const app = buildApp(config, {
    authService,
    userService,
    projectService,
    memberService,
    close
  });

  const password = runtimePassword();
  const username = `admin-${randomUUID()}`;
  await userService.bootstrapAdmin({
    username,
    displayName: "Administrator",
    password
  });
  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: config.webOrigin },
    payload: { username, password, deviceName: "Browser" }
  });
  const cookie = (loginResponse.headers["set-cookie"] as string).split(
    ";",
    1
  )[0] as string;
  const principal = await authService.authenticate(
    cookie.split("=", 2)[1] as string
  );

  return {
    app,
    close,
    config,
    projectService,
    memberService,
    principal,
    projectId,
    memberId,
    authenticatedHeaders: { cookie },
    authenticatedWriteHeaders: { cookie, origin: config.webOrigin }
  };
}

function expectNoBusinessServiceCalls(
  harness: Awaited<ReturnType<typeof createProjectsHttpHarness>>
): void {
  for (const serviceMethod of [
    ...Object.values(harness.projectService),
    ...Object.values(harness.memberService)
  ]) {
    expect(serviceMethod).not.toHaveBeenCalled();
  }
}

describe("project and member HTTP API", () => {
  it("lists visible projects with all filters and complete response fields", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/projects?query=%E8%99%9A%E6%9E%84&year=2026&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&lifecycle=ACTIVE&page=2&pageSize=1",
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projectPage);
      expect(harness.projectService.listProjects).toHaveBeenCalledWith(
        harness.principal,
        {
          query: "虚构",
          year: 2026,
          status: "施工中",
          lifecycle: "ACTIVE",
          page: 2,
          pageSize: 1
        }
      );
    } finally {
      await harness.app.close();
    }
  });

  it("uses default project list pagination when query params are omitted", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(harness.projectService.listProjects).toHaveBeenCalledWith(
        harness.principal,
        { page: 1, pageSize: 20 }
      );
    } finally {
      await harness.app.close();
    }
  });

  it("creates a project and passes the exact service input", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const input = { project: projectInput, ownerUserId };
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: harness.authenticatedWriteHeaders,
        payload: input
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(projectDetails);
      expect(harness.projectService.createProject).toHaveBeenCalledWith(
        harness.principal,
        input
      );
    } finally {
      await harness.app.close();
    }
  });

  it("gets project details with complete permissions", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projectDetails);
      expect(harness.projectService.getProject).toHaveBeenCalledWith(
        harness.principal,
        projectId
      );
    } finally {
      await harness.app.close();
    }
  });

  it("updates a project with the exact project DTO", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedWriteHeaders,
        payload: projectInput
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projectDetails);
      expect(harness.projectService.updateProject).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        projectInput
      );
    } finally {
      await harness.app.close();
    }
  });

  it("maps a valid missing project update to 404 with exact service arguments", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      harness.projectService.updateProject.mockRejectedValueOnce(
        new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found")
      );

      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedWriteHeaders,
        payload: projectInput
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found"
      });
      expect(harness.projectService.updateProject).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        projectInput
      );
    } finally {
      await harness.app.close();
    }
  });

  it("archives a project", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/archive`,
        headers: harness.authenticatedWriteHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projectDetails);
      expect(harness.projectService.archiveProject).toHaveBeenCalledWith(
        harness.principal,
        projectId
      );
    } finally {
      await harness.app.close();
    }
  });

  it("restores a project", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/restore`,
        headers: harness.authenticatedWriteHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projectDetails);
      expect(harness.projectService.restoreProject).toHaveBeenCalledWith(
        harness.principal,
        projectId
      );
    } finally {
      await harness.app.close();
    }
  });

  it("lists paginated project audit events", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/audit-events?page=3&pageSize=100`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(auditPage);
      expect(harness.projectService.listAuditEvents).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        3,
        100
      );
    } finally {
      await harness.app.close();
    }
  });

  it("does not serialize sensitive audit values while preserving their field names", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const unsafeAuditPage = structuredClone(auditPage) as unknown as {
        items: Array<{
          event: {
            changeSummary: {
              before: Record<string, string | null>;
              after: Record<string, string | null>;
            };
          };
        }>;
      };
      unsafeAuditPage.items[0]!.event.changeSummary.before.jobTitle =
        "not-public";
      unsafeAuditPage.items[0]!.event.changeSummary.after.phone = "not-public";
      unsafeAuditPage.items[0]!.event.changeSummary.after.remark = "not-public";
      harness.projectService.listAuditEvents.mockResolvedValueOnce(
        unsafeAuditPage as unknown as ProjectAuditPage
      );

      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/audit-events`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      const summary =
        response.json<ProjectAuditPage>().items[0]!.event.changeSummary;
      expect(summary.fields).toEqual(
        expect.arrayContaining(["jobTitle", "phone", "remark"])
      );
      expect(summary.before).not.toHaveProperty("jobTitle");
      expect(summary.after).not.toHaveProperty("phone");
      expect(summary.after).not.toHaveProperty("remark");
      expect(response.body).not.toContain("not-public");
    } finally {
      await harness.app.close();
    }
  });

  it("uses default audit pagination when query params are omitted", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/audit-events`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(harness.projectService.listAuditEvents).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        1,
        20
      );
    } finally {
      await harness.app.close();
    }
  });

  it("lists project members with complete member and user fields", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/members`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([memberView]);
      expect(harness.memberService.listMembers).toHaveBeenCalledWith(
        harness.principal,
        projectId
      );
    } finally {
      await harness.app.close();
    }
  });

  it("searches project member candidates", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/member-candidates?query=%E9%A1%B9%E7%9B%AE`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([candidate]);
      expect(harness.memberService.searchCandidates).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        "项目"
      );
    } finally {
      await harness.app.close();
    }
  });

  it("rejects one-character candidate queries before calling the service", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/member-candidates?query=%E9%A1%B9`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request"
      });
      expect(harness.memberService.searchCandidates).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it("adds a project member", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const input = {
        userId: candidateUserId,
        memberRole: "EDITOR" as const,
        jobTitle: "策划",
        phone: "",
        remark: "虚构新增成员"
      };
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/members`,
        headers: harness.authenticatedWriteHeaders,
        payload: input
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(memberView);
      expect(harness.memberService.addMember).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        input
      );
    } finally {
      await harness.app.close();
    }
  });

  it("updates a project member", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const input = {
        memberRole: "VIEWER" as const,
        jobTitle: "顾问",
        phone: "000-1111",
        remark: "虚构更新"
      };
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}/members/${memberId}`,
        headers: harness.authenticatedWriteHeaders,
        payload: input
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(memberView);
      expect(harness.memberService.updateMember).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        memberId,
        input
      );
    } finally {
      await harness.app.close();
    }
  });

  it("removes a project member without returning a body", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${projectId}/members/${memberId}`,
        headers: harness.authenticatedWriteHeaders
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(harness.memberService.removeMember).toHaveBeenCalledWith(
        harness.principal,
        projectId,
        memberId
      );
    } finally {
      await harness.app.close();
    }
  });

  it.each([
    ["GET", "/api/v1/projects", undefined],
    ["POST", "/api/v1/projects", { project: projectInput, ownerUserId }],
    ["GET", `/api/v1/projects/${projectId}`, undefined],
    ["PATCH", `/api/v1/projects/${projectId}`, projectInput],
    ["POST", `/api/v1/projects/${projectId}/archive`, undefined],
    ["POST", `/api/v1/projects/${projectId}/restore`, undefined],
    ["GET", `/api/v1/projects/${projectId}/audit-events`, undefined],
    ["GET", `/api/v1/projects/${projectId}/members`, undefined],
    [
      "GET",
      `/api/v1/projects/${projectId}/member-candidates?query=%E9%A1%B9%E7%9B%AE`,
      undefined
    ],
    [
      "POST",
      `/api/v1/projects/${projectId}/members`,
      {
        userId: candidateUserId,
        memberRole: "EDITOR",
        jobTitle: "",
        phone: "",
        remark: ""
      }
    ],
    [
      "PATCH",
      `/api/v1/projects/${projectId}/members/${memberId}`,
      { memberRole: "VIEWER", jobTitle: "", phone: "", remark: "" }
    ],
    ["DELETE", `/api/v1/projects/${projectId}/members/${memberId}`, undefined]
  ] as const)(
    "authenticates %s %s before business handling",
    async (method, url, payload) => {
      const harness = await createProjectsHttpHarness();
      try {
        const response = await harness.app.inject({
          method,
          url,
          headers: { origin: harness.config.webOrigin },
          ...(payload === undefined ? {} : { payload })
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required"
        });
        expectNoBusinessServiceCalls(harness);
      } finally {
        await harness.app.close();
      }
    }
  );

  it.each([
    ["POST", "/api/v1/projects", { project: projectInput, ownerUserId }],
    ["PATCH", `/api/v1/projects/${projectId}`, projectInput],
    ["POST", `/api/v1/projects/${projectId}/archive`, undefined],
    ["POST", `/api/v1/projects/${projectId}/restore`, undefined],
    [
      "POST",
      `/api/v1/projects/${projectId}/members`,
      {
        userId: candidateUserId,
        memberRole: "EDITOR",
        jobTitle: "",
        phone: "",
        remark: ""
      }
    ],
    [
      "PATCH",
      `/api/v1/projects/${projectId}/members/${memberId}`,
      { memberRole: "VIEWER", jobTitle: "", phone: "", remark: "" }
    ],
    ["DELETE", `/api/v1/projects/${projectId}/members/${memberId}`, undefined]
  ] as const)(
    "enforces same-origin for %s %s",
    async (method, url, payload) => {
      const harness = await createProjectsHttpHarness();
      try {
        const response = await harness.app.inject({
          method,
          url,
          headers: {
            ...harness.authenticatedHeaders,
            origin: "https://mismatch.example.test"
          },
          ...(payload === undefined ? {} : { payload })
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
          code: "FORBIDDEN",
          message: "Operation is not allowed"
        });
        expectNoBusinessServiceCalls(harness);
      } finally {
        await harness.app.close();
      }
    }
  );

  it("rejects extra project fields before calling the service", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedWriteHeaders,
        payload: { ...projectInput, unsupported: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request"
      });
      expect(harness.projectService.updateProject).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it("rejects invalid UUID params and out-of-range page sizes", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      const invalidUuid = await harness.app.inject({
        method: "GET",
        url: "/api/v1/projects/not-a-uuid",
        headers: harness.authenticatedHeaders
      });
      const invalidPageSize = await harness.app.inject({
        method: "GET",
        url: "/api/v1/projects?pageSize=101",
        headers: harness.authenticatedHeaders
      });

      expect(invalidUuid.statusCode).toBe(400);
      expect(invalidPageSize.statusCode).toBe(400);
      expectNoBusinessServiceCalls(harness);
    } finally {
      await harness.app.close();
    }
  });

  it.each([
    ["VALIDATION_ERROR", 400],
    ["FORBIDDEN", 403],
    ["PROJECT_NOT_FOUND", 404],
    ["MEMBER_NOT_FOUND", 404],
    ["MEMBER_ALREADY_EXISTS", 409],
    ["LAST_OWNER_REQUIRED", 409],
    ["INVALID_PROJECT_STATE", 409],
    ["USER_NOT_AVAILABLE", 409]
  ] as const)("maps %s to HTTP %i", async (code, statusCode) => {
    const harness = await createProjectsHttpHarness();
    try {
      harness.projectService.getProject.mockRejectedValueOnce(
        new ProjectServiceError(code, "Business rule rejected")
      );
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual({
        code,
        message: "Business rule rejected"
      });
    } finally {
      await harness.app.close();
    }
  });

  it("returns a generic 500 without leaking unknown error details", async () => {
    const harness = await createProjectsHttpHarness();
    try {
      harness.projectService.getProject.mockRejectedValueOnce(
        new Error("private connection and storage details")
      );
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}`,
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      });
      expect(response.body).not.toContain("private connection");
    } finally {
      await harness.app.close();
    }
  });

  it("closes runtime services when the Fastify app closes", async () => {
    const harness = await createProjectsHttpHarness();

    await harness.app.close();

    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});
