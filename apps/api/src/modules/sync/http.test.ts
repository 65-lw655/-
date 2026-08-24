import { createHmac, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectInput } from "@project-online/domain";
import {
  PROTOCOL_VERSION,
  type PullProjectsResponse,
  type PushProjectsRequest,
  type PushProjectsResponse
} from "@project-online/sync";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../app.js";
import type { ApiConfig } from "../../config.js";
import { runMigrations } from "../../database/migrate.js";
import { withTestDatabase } from "../../database/test-database.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { AuthService, AuthServiceError } from "../auth/auth-service.js";
import type { ApiServices } from "../auth/routes.js";
import type { PasswordHasher } from "../auth/password.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import { MemberService } from "../projects/member-service.js";
import { PostgresProjectRepository } from "../projects/postgres-project-repository.js";
import { ProjectService } from "../projects/project-service.js";
import { UserService } from "../users/user-service.js";
import { SyncService } from "./sync-service.js";

type SyncApiService = Pick<SyncService, "pushProjects" | "pullProjects">;

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations"
);

const acceptanceProjectInput: ProjectInput = {
  name: "虚构验收同步项目",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

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

function createProjectServiceStubs(): Pick<
  ApiServices,
  "projectService" | "memberService"
> {
  return {
    projectService: {
      listProjects: vi.fn<ApiServices["projectService"]["listProjects"]>(),
      createProject: vi.fn<ApiServices["projectService"]["createProject"]>(),
      getProject: vi.fn<ApiServices["projectService"]["getProject"]>(),
      updateProject: vi.fn<ApiServices["projectService"]["updateProject"]>(),
      archiveProject: vi.fn<ApiServices["projectService"]["archiveProject"]>(),
      restoreProject: vi.fn<ApiServices["projectService"]["restoreProject"]>(),
      listAuditEvents: vi.fn<ApiServices["projectService"]["listAuditEvents"]>()
    },
    memberService: {
      listMembers: vi.fn<ApiServices["memberService"]["listMembers"]>(),
      searchCandidates:
        vi.fn<ApiServices["memberService"]["searchCandidates"]>(),
      addMember: vi.fn<ApiServices["memberService"]["addMember"]>(),
      updateMember: vi.fn<ApiServices["memberService"]["updateMember"]>(),
      removeMember: vi.fn<ApiServices["memberService"]["removeMember"]>()
    }
  };
}

async function createHarness() {
  const store = new MemoryAuthStateStore();
  const passwordHasher = createHasher();
  const authService = new AuthService(
    store,
    await passwordHasher.hash(runtimePassword()),
    { passwordHasher }
  );
  const userService = new UserService(store, { passwordHasher });
  const syncService = {
    pushProjects: vi.fn<SyncService["pushProjects"]>(),
    pullProjects: vi.fn<SyncService["pullProjects"]>()
  } satisfies SyncApiService;
  const close = vi.fn(async () => undefined);
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 3000,
    environment: "test",
    webOrigin: "https://web.example.test",
    authStorePath: ".local-data/auth-store.json"
  };
  const services: ApiServices & { syncService: SyncApiService } = {
    authService,
    userService,
    ...createProjectServiceStubs(),
    syncService,
    close
  };
  const app = buildApp(config, services);

  const password = runtimePassword();
  const username = `admin-${randomUUID()}`;
  const user = await userService.bootstrapAdmin({
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
    config,
    syncService,
    principal,
    userId: user.id,
    authenticatedHeaders: { cookie },
    authenticatedWriteHeaders: { cookie, origin: config.webOrigin }
  };
}

async function login(
  app: ReturnType<typeof buildApp>,
  authService: AuthService,
  config: ApiConfig,
  username: string,
  password: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: config.webOrigin },
    payload: { username, password, deviceName: "Browser" }
  });
  const cookie = (response.headers["set-cookie"] as string).split(";", 1)[0]!;
  const principal = await authService.authenticate(
    cookie.split("=", 2)[1] as string
  );
  return { cookie, principal };
}

async function createPostgresHarness(pool: Pool) {
  await runMigrations(pool, migrationsDirectory);
  const store = new MemoryAuthStateStore();
  const passwordHasher = createHasher();
  const authService = new AuthService(
    store,
    await passwordHasher.hash(runtimePassword()),
    { passwordHasher }
  );
  const userService = new UserService(store, { passwordHasher });
  const authorizationService = new AuthorizationService(store);
  const repository = new PostgresProjectRepository(pool);
  const projectService = new ProjectService(
    repository,
    authorizationService,
    store
  );
  const memberService = new MemberService(
    repository,
    authorizationService,
    store
  );
  const syncService = new SyncService(repository, authorizationService);
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
    syncService,
    close
  });

  return {
    app,
    authService,
    userService,
    projectService,
    memberService,
    config
  };
}

function samplePushRequest(): PushProjectsRequest {
  const projectId = "11111111-1111-4111-8111-111111111111";
  return {
    protocolVersion: PROTOCOL_VERSION,
    deviceId: "22222222-2222-4222-8222-222222222222",
    operations: [
      {
        protocolVersion: PROTOCOL_VERSION,
        operationId: "33333333-3333-4333-8333-333333333333",
        deviceId: "22222222-2222-4222-8222-222222222222",
        clientSequence: 1,
        entityType: "PROJECT",
        entityId: projectId,
        projectId,
        action: "UPSERT",
        baseRevision: 7,
        payload: {
          name: "虚构同步项目",
          year: 2026,
          type: "展览展示",
          status: "施工中",
          phase: "现场实施",
          filingStatus: "无需报建",
          plannedCompletionDate: "2026-12-31",
          actualCompletionDate: null
        }
      }
    ]
  };
}

function samplePushResponse(
  request: PushProjectsRequest,
  status: PushProjectsResponse["results"][number]["status"] = "ACCEPTED"
): PushProjectsResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    results: [
      {
        operationId: request.operations[0]!.operationId,
        status,
        entityId: request.operations[0]!.entityId,
        revision: 8,
        commitSequence: 19,
        conflict: false,
        serverCommittedAt: "2026-08-24T10:00:00.000Z"
      }
    ]
  };
}

function samplePullResponse(): PullProjectsResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    changes: [
      {
        type: "PROJECT",
        entityId: "11111111-1111-4111-8111-111111111111",
        projectId: "11111111-1111-4111-8111-111111111111",
        revision: 8,
        commitSequence: 19,
        deleted: false,
        project: {
          name: "虚构同步项目",
          year: 2026,
          type: "展览展示",
          status: "施工中",
          phase: "现场实施",
          filingStatus: "无需报建",
          plannedCompletionDate: "2026-12-31",
          actualCompletionDate: null
        }
      }
    ],
    nextCursor: 19,
    hasMore: true
  };
}

function sampleRevocationPullResponse(): PullProjectsResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    changes: [
      {
        type: "PROJECT_ACCESS_REVOKED",
        projectId: "11111111-1111-4111-8111-111111111111",
        commitSequence: 20
      }
    ],
    nextCursor: 20,
    hasMore: false
  };
}

describe("sync HTTP API", () => {
  it("requires an authenticated session for push and pull", async () => {
    const harness = await createHarness();
    try {
      const pushResponse = await harness.app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: { origin: harness.config.webOrigin },
        payload: samplePushRequest()
      });
      const pullResponse = await harness.app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?after=0&limit=1"
      });

      expect(pushResponse.statusCode).toBe(401);
      expect(pushResponse.json()).toEqual({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required"
      });
      expect(pullResponse.statusCode).toBe(401);
      expect(pullResponse.json()).toEqual({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required"
      });
      expect(harness.syncService.pushProjects).not.toHaveBeenCalled();
      expect(harness.syncService.pullProjects).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it("rejects invalid push bodies before calling the service", async () => {
    const harness = await createHarness();
    try {
      const request = samplePushRequest();
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: harness.authenticatedWriteHeaders,
        payload: { ...request, unexpected: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request"
      });
      expect(harness.syncService.pushProjects).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it("accepts push requests and forwards the exact authenticated principal and payload", async () => {
    const harness = await createHarness();
    try {
      const request = samplePushRequest();
      const result = samplePushResponse(request);
      harness.syncService.pushProjects.mockResolvedValueOnce(result);

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: harness.authenticatedWriteHeaders,
        payload: request
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(harness.syncService.pushProjects).toHaveBeenCalledWith(
        harness.principal,
        request
      );
    } finally {
      await harness.app.close();
    }
  });

  it("returns duplicate push results unchanged", async () => {
    const harness = await createHarness();
    try {
      const request = samplePushRequest();
      const result = samplePushResponse(request, "DUPLICATE");
      harness.syncService.pushProjects.mockResolvedValueOnce(result);

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: harness.authenticatedWriteHeaders,
        payload: request
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
    } finally {
      await harness.app.close();
    }
  });

  it("validates pull pagination and forwards the parsed cursor query", async () => {
    const harness = await createHarness();
    try {
      const invalid = await harness.app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?after=0&limit=501",
        headers: harness.authenticatedHeaders
      });
      const result = samplePullResponse();
      harness.syncService.pullProjects.mockResolvedValueOnce(result);
      const valid = await harness.app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?after=18&limit=1",
        headers: harness.authenticatedHeaders
      });

      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request"
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toEqual(result);
      expect(harness.syncService.pullProjects).toHaveBeenCalledWith(
        harness.principal,
        { after: 18, limit: 1 }
      );
    } finally {
      await harness.app.close();
    }
  });

  it("accepts pull responses that contain project access revoked instructions", async () => {
    const harness = await createHarness();
    try {
      const result = sampleRevocationPullResponse();
      harness.syncService.pullProjects.mockResolvedValueOnce(result);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?after=19&limit=1",
        headers: harness.authenticatedHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
    } finally {
      await harness.app.close();
    }
  });

  it("maps sync service session failures to the shared API error response", async () => {
    const harness = await createHarness();
    try {
      harness.syncService.pushProjects.mockRejectedValueOnce(
        new AuthServiceError("INVALID_SESSION")
      );

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: harness.authenticatedWriteHeaders,
        payload: samplePushRequest()
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: "SESSION_EXPIRED",
        message: "Authentication session is invalid"
      });
    } finally {
      await harness.app.close();
    }
  });

  it("verifies the isolated project sync vertical slice end to end", async () => {
    await withTestDatabase(async (pool) => {
      const harness = await createPostgresHarness(pool);
      try {
        const adminPassword = runtimePassword();
        const adminUsername = `admin-${randomUUID()}`;
        const admin = await harness.userService.bootstrapAdmin({
          username: adminUsername,
          displayName: "虚构管理员",
          password: adminPassword
        });
        const adminSession = await login(
          harness.app,
          harness.authService,
          harness.config,
          adminUsername,
          adminPassword
        );
        const syncUserPassword = runtimePassword();
        const syncUsername = `sync-${randomUUID()}`;
        const syncUser = await harness.userService.createUser(
          adminSession.principal,
          {
            username: syncUsername,
            displayName: "虚构同步用户",
            role: "USER"
          }
        );
        await harness.userService.activate({
          ticket: syncUser.ticket,
          password: syncUserPassword
        });
        const syncSession = await login(
          harness.app,
          harness.authService,
          harness.config,
          syncUsername,
          syncUserPassword
        );
        const created = await harness.projectService.createProject(
          adminSession.principal,
          {
            project: acceptanceProjectInput,
            ownerUserId: syncUser.user.id
          }
        );
        await harness.memberService.addMember(
          adminSession.principal,
          created.project.id,
          {
            userId: admin.id,
            memberRole: "OWNER",
            jobTitle: "验收负责人",
            phone: "",
            remark: "虚构验收成员"
          }
        );
        const current = await harness.projectService.getProject(
          adminSession.principal,
          created.project.id
        );
        const deviceId = randomUUID();
        const pushRequest: PushProjectsRequest = {
          protocolVersion: PROTOCOL_VERSION,
          deviceId,
          operations: [
            {
              protocolVersion: PROTOCOL_VERSION,
              operationId: randomUUID(),
              deviceId,
              clientSequence: 1,
              entityType: "PROJECT",
              entityId: current.project.id,
              projectId: current.project.id,
              action: "UPSERT",
              baseRevision: current.project.revision,
              payload: {
                ...acceptanceProjectInput,
                name: "虚构验收同步项目（已同步）"
              }
            }
          ]
        };

        const firstPush = await harness.app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers: {
            cookie: syncSession.cookie,
            origin: harness.config.webOrigin
          },
          payload: pushRequest
        });
        const retryPush = await harness.app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers: {
            cookie: syncSession.cookie,
            origin: harness.config.webOrigin
          },
          payload: pushRequest
        });

        expect(firstPush.statusCode).toBe(200);
        expect(retryPush.statusCode).toBe(200);
        expect(retryPush.json()).toEqual(firstPush.json());
        const accepted = firstPush.json<PushProjectsResponse>().results[0]!;
        expect(accepted).toMatchObject({
          operationId: pushRequest.operations[0]!.operationId,
          status: "ACCEPTED",
          entityId: current.project.id,
          conflict: false
        });
        expect(accepted.commitSequence).toBeGreaterThan(
          current.project.commitSequence
        );

        const pull = await harness.app.inject({
          method: "GET",
          url: `/api/v1/sync/pull?after=${accepted.commitSequence! - 1}&limit=10`,
          headers: { cookie: syncSession.cookie }
        });
        expect(pull.statusCode).toBe(200);
        expect(pull.json<PullProjectsResponse>()).toEqual({
          protocolVersion: PROTOCOL_VERSION,
          changes: [
            {
              type: "PROJECT",
              entityId: current.project.id,
              projectId: current.project.id,
              revision: accepted.revision!,
              commitSequence: accepted.commitSequence!,
              deleted: false,
              project: {
                ...acceptanceProjectInput,
                name: "虚构验收同步项目（已同步）"
              }
            }
          ],
          nextCursor: accepted.commitSequence!,
          hasMore: false
        });

        const members = await harness.memberService.listMembers(
          adminSession.principal,
          current.project.id
        );
        const syncMember = members.find(
          ({ member }) => member.userId === syncUser.user.id
        )!;
        await harness.memberService.removeMember(
          adminSession.principal,
          current.project.id,
          syncMember.member.id
        );
        const afterRevocation = await harness.app.inject({
          method: "GET",
          url: `/api/v1/sync/pull?after=${accepted.commitSequence! - 1}&limit=10`,
          headers: { cookie: syncSession.cookie }
        });

        expect(afterRevocation.statusCode).toBe(200);
        expect(afterRevocation.json<PullProjectsResponse>()).toEqual({
          protocolVersion: PROTOCOL_VERSION,
          changes: [],
          nextCursor: accepted.commitSequence! - 1,
          hasMore: false
        });
      } finally {
        await harness.app.close();
      }
    });
  });
});
