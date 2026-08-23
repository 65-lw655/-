import { ApiClientError } from "../../api-client.js";
import { describe, expect, it, vi } from "vitest";

import { createProjectsClient } from "./projects-client.js";

const projectId = "8a5a69cc-4f4b-4d1d-ae25-2e7fc6f04acf";
const memberId = "2c7f7e23-d68d-4c7a-9c8f-6b65da2d7024";
const userId = "448da5f0-50f3-4c56-9747-bc757d42cf9b";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function projectRecord() {
  return {
    id: projectId,
    name: "示例项目",
    year: 2026,
    type: "展陈",
    status: "施工中",
    phase: "施工",
    filingStatus: "已备案",
    plannedCompletionDate: "2026-12-31",
    actualCompletionDate: null,
    lifecycle: "ACTIVE",
    createdAt: "2026-08-14T00:00:00.000Z",
    createdBy: userId,
    updatedAt: "2026-08-14T00:00:00.000Z",
    updatedBy: userId,
    revision: 1,
    commitSequence: 1,
    archivedAt: null,
    archivedBy: null
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    username: "owner",
    displayName: "示例负责人",
    role: "USER",
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides
  };
}

function userSummary() {
  return {
    id: userId,
    username: "owner",
    displayName: "示例负责人",
    accountStatus: "ACTIVE"
  };
}

function projectDetailsResponse() {
  return {
    project: projectRecord(),
    permissions: {
      canEdit: true,
      canManageMembers: true,
      canChangeLifecycle: true,
      canReadAudit: true
    }
  };
}

function projectPageResponse() {
  return {
    items: [{ project: projectRecord(), owners: [userSummary()] }],
    page: 2,
    pageSize: 20,
    total: 1
  };
}

function memberViewResponse() {
  return {
    member: {
      id: memberId,
      projectId,
      userId,
      memberRole: "OWNER",
      jobTitle: "项目经理",
      phone: "13800000000",
      remark: "示例备注",
      createdAt: "2026-08-14T00:00:00.000Z",
      createdBy: userId,
      updatedAt: "2026-08-14T00:00:00.000Z",
      updatedBy: userId
    },
    user: userSummary()
  };
}

function candidateResponse() {
  return [{ id: userId, username: "owner", displayName: "示例负责人" }];
}

function auditPageResponse() {
  return {
    items: [
      {
        event: {
          id: "a7f5a5b4-cdf0-4c20-a9c7-0486c6664689",
          projectId,
          commitSequence: 1,
          eventType: "PROJECT_CREATED",
          actorUserId: userId,
          targetType: "PROJECT",
          targetId: projectId,
          changeSummary: {
            fields: ["name", "year"],
            after: { name: "示例项目", year: "2026" }
          },
          occurredAt: "2026-08-14T00:00:00.000Z"
        },
        actor: userSummary()
      }
    ],
    page: 3,
    pageSize: 20,
    total: 1
  };
}

const projectInput = {
  name: "示例项目",
  year: 2026,
  type: "展陈",
  status: "施工中" as const,
  phase: "施工",
  filingStatus: "已备案",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

const memberInput = {
  memberRole: "EDITOR" as const,
  jobTitle: "设计师",
  phone: "13900000000",
  remark: "新增成员"
};

describe("ProjectsClient", () => {
  it("encodes project filters in the documented query order", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(projectPageResponse()));
    const client = createProjectsClient("/api", fetchImpl);

    await expect(
      client.listProjects({
        query: "示例项目",
        year: 2026,
        status: "施工中",
        lifecycle: "ACTIVE",
        page: 2,
        pageSize: 20
      })
    ).resolves.toEqual(projectPageResponse());

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/projects?query=%E7%A4%BA%E4%BE%8B%E9%A1%B9%E7%9B%AE&year=2026&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&lifecycle=ACTIVE&page=2&pageSize=20",
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        credentials: "same-origin"
      }
    );
  });

  it("filters the complete users response to active ready initial owners", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([
        user(),
        user({
          id: "7e91cd7d-fafb-435f-8701-e1e1fafad40e",
          accountStatus: "DISABLED"
        }),
        user({
          id: "1a27c9c2-93d0-4b24-a280-4b7dc1a0c8d0",
          credentialStatus: "PENDING_ACTIVATION"
        })
      ])
    );
    const client = createProjectsClient("/api", fetchImpl);

    await expect(client.listInitialOwnerCandidates()).resolves.toEqual([
      { id: userId, username: "owner", displayName: "示例负责人" }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/users", {
      cache: "no-store",
      headers: { accept: "application/json" },
      credentials: "same-origin"
    });
  });

  it("encodes project identifiers and reads every project resource", async () => {
    const encodedProjectId = "project/id with space";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(projectDetailsResponse()))
      .mockResolvedValueOnce(jsonResponse([memberViewResponse()]))
      .mockResolvedValueOnce(jsonResponse(candidateResponse()))
      .mockResolvedValueOnce(jsonResponse(auditPageResponse()));
    const client = createProjectsClient("/api", fetchImpl);

    await expect(client.getProject(encodedProjectId)).resolves.toEqual(
      projectDetailsResponse()
    );
    await expect(client.listMembers(encodedProjectId)).resolves.toEqual([
      memberViewResponse()
    ]);
    await expect(
      client.searchMemberCandidates(encodedProjectId, "张 三")
    ).resolves.toEqual(candidateResponse());
    await expect(client.listAuditEvents(encodedProjectId, 3)).resolves.toEqual(
      auditPageResponse()
    );

    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/projects/project%2Fid%20with%20space",
      "/api/v1/projects/project%2Fid%20with%20space/members",
      "/api/v1/projects/project%2Fid%20with%20space/member-candidates?query=%E5%BC%A0+%E4%B8%89",
      "/api/v1/projects/project%2Fid%20with%20space/audit-events?page=3&pageSize=20"
    ]);
  });

  it.each([
    {
      name: "createProject",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.createProject({ project: projectInput, ownerUserId: userId }),
      response: projectDetailsResponse(),
      path: "/api/v1/projects",
      method: "POST",
      body: { project: projectInput, ownerUserId: userId }
    },
    {
      name: "updateProject",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.updateProject("project/id", projectInput),
      response: projectDetailsResponse(),
      path: "/api/v1/projects/project%2Fid",
      method: "PATCH",
      body: projectInput
    },
    {
      name: "archiveProject",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.archiveProject("project/id"),
      response: projectDetailsResponse(),
      path: "/api/v1/projects/project%2Fid/archive",
      method: "POST",
      body: {}
    },
    {
      name: "restoreProject",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.restoreProject("project/id"),
      response: projectDetailsResponse(),
      path: "/api/v1/projects/project%2Fid/restore",
      method: "POST",
      body: {}
    },
    {
      name: "addMember",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.addMember("project/id", { userId, ...memberInput }),
      response: memberViewResponse(),
      path: "/api/v1/projects/project%2Fid/members",
      method: "POST",
      body: { userId, ...memberInput }
    },
    {
      name: "updateMember",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.updateMember("project/id", "member/id", memberInput),
      response: memberViewResponse(),
      path: "/api/v1/projects/project%2Fid/members/member%2Fid",
      method: "PATCH",
      body: memberInput
    },
    {
      name: "removeMember",
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.removeMember("project/id", "member/id"),
      response: null,
      path: "/api/v1/projects/project%2Fid/members/member%2Fid",
      method: "DELETE",
      body: undefined
    }
  ])(
    "sends the $name mutation contract",
    async ({ invoke, response, path, method, body }) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response === null
            ? new Response(null, { status: 204 })
            : jsonResponse(response, method === "POST" ? 201 : 200)
        );
      const client = createProjectsClient("/api", fetchImpl);

      await expect(invoke(client)).resolves.toEqual(
        response === null ? undefined : response
      );

      expect(fetchImpl).toHaveBeenCalledWith(path, {
        method,
        headers:
          method === "DELETE"
            ? { accept: "application/json" }
            : {
                accept: "application/json",
                "content-type": "application/json"
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "same-origin"
      });
    }
  );

  it.each([
    {
      name: "project page project name",
      response: {
        ...projectPageResponse(),
        items: [
          { project: { ...projectRecord(), name: 7 }, owners: [userSummary()] }
        ]
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listProjects({ page: 1, pageSize: 20 })
    },
    {
      name: "project UUID",
      response: {
        ...projectPageResponse(),
        items: [
          {
            project: { ...projectRecord(), id: "not-a-uuid" },
            owners: [userSummary()]
          }
        ]
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listProjects({ page: 1, pageSize: 20 })
    },
    {
      name: "full M2 user credential status",
      response: [user({ credentialStatus: "INVALID" })],
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listInitialOwnerCandidates()
    },
    {
      name: "project details permission",
      response: {
        ...projectDetailsResponse(),
        permissions: { ...projectDetailsResponse().permissions, canEdit: "yes" }
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.getProject(projectId)
    },
    {
      name: "project date-only value",
      response: {
        ...projectDetailsResponse(),
        project: {
          ...projectRecord(),
          plannedCompletionDate: "2026-02-30"
        }
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.getProject(projectId)
    },
    {
      name: "member phone",
      response: [
        {
          ...memberViewResponse(),
          member: { ...memberViewResponse().member, phone: 7 }
        }
      ],
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listMembers(projectId)
    },
    {
      name: "candidate display name",
      response: [{ ...candidateResponse()[0], displayName: 7 }],
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.searchMemberCandidates(projectId, "示例")
    },
    {
      name: "audit event occurred time",
      response: {
        ...auditPageResponse(),
        items: [
          {
            ...auditPageResponse().items[0]!,
            event: {
              ...auditPageResponse().items[0]!.event,
              occurredAt: "2026-08-14T00:00:00"
            }
          }
        ]
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listAuditEvents(projectId, 1)
    },
    {
      name: "sensitive audit values",
      response: {
        ...auditPageResponse(),
        items: [
          {
            ...auditPageResponse().items[0]!,
            event: {
              ...auditPageResponse().items[0]!.event,
              changeSummary: {
                fields: ["jobTitle", "phone", "remark"],
                before: { jobTitle: "not-public" },
                after: { phone: "not-public", remark: "not-public" }
              }
            }
          }
        ]
      },
      invoke: (client: ReturnType<typeof createProjectsClient>) =>
        client.listAuditEvents(projectId, 1)
    }
  ])(
    "rejects malformed $name while preserving response status",
    async ({ response, invoke }) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(response, 200));

      await expect(
        invoke(createProjectsClient("/api", fetchImpl))
      ).rejects.toMatchObject({
        status: 200,
        code: "INVALID_RESPONSE"
      });
    }
  );

  it.each([
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "FORBIDDEN"],
    [404, "PROJECT_NOT_FOUND"],
    [409, "LAST_OWNER_REQUIRED"]
  ] as const)("preserves %i %s API errors", async (status, code) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ code, message: "请求被拒绝" }, status)
      );

    await expect(
      createProjectsClient("/api", fetchImpl).getProject(projectId)
    ).rejects.toEqual(expect.any(ApiClientError));
    await expect(
      createProjectsClient("/api", fetchImpl).getProject(projectId)
    ).rejects.toMatchObject({ status, code });
  });
});
