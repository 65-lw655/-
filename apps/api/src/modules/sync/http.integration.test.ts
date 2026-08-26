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
import { AuthService } from "../auth/auth-service.js";
import type { PasswordHasher } from "../auth/password.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import { MemberService } from "../projects/member-service.js";
import { PostgresProjectRepository } from "../projects/postgres-project-repository.js";
import { ProjectService } from "../projects/project-service.js";
import { UserService } from "../users/user-service.js";
import { SyncService } from "./sync-service.js";

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

describe("sync HTTP API isolated PostgreSQL acceptance", () => {
  it("verifies the project sync vertical slice end to end", async () => {
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
