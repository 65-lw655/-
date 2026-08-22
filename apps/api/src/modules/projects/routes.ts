import type {
  MemberInput,
  ProjectInput,
  ProjectLifecycle,
  ProjectListFilters,
  ProjectStatus
} from "@project-online/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiConfig } from "../../config.js";
import {
  assertSameOrigin,
  readSessionToken,
  type ApiServices
} from "../auth/routes.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import type { AddMemberInput } from "./member-service.js";
import {
  addMemberBodySchema,
  apiErrorResponseSchemas,
  auditPageSchema,
  candidateQuerySchema,
  candidateResultsSchema,
  createProjectBodySchema,
  emptyObjectSchema,
  memberInputSchema,
  memberViewSchema,
  paginationQuerySchema,
  projectDetailsSchema,
  projectInputSchema,
  projectListQuerySchema,
  projectMemberParamsSchema,
  projectPageSchema,
  projectParamsSchema
} from "./schemas.js";

interface ProjectParams {
  projectId: string;
}

interface ProjectMemberParams extends ProjectParams {
  memberId: string;
}

interface ProjectListQuery {
  query?: string;
  year?: number;
  status?: ProjectStatus;
  lifecycle?: ProjectLifecycle;
  page?: number;
  pageSize?: number;
}

interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

async function allowMissingBody(request: FastifyRequest): Promise<void> {
  if (request.body === undefined) {
    request.body = {};
  }
}

function authenticate(
  request: FastifyRequest,
  config: ApiConfig,
  services: ApiServices
): Promise<AuthenticatedPrincipal> {
  return services.authService.authenticate(readSessionToken(request, config));
}

export function registerProjectRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  services: ApiServices
): void {
  app.get<{ Querystring: ProjectListQuery }>(
    "/api/v1/projects",
    {
      schema: {
        querystring: projectListQuerySchema,
        response: { ...apiErrorResponseSchemas, 200: projectPageSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      const filters: ProjectListFilters = {
        ...(request.query.query === undefined
          ? {}
          : { query: request.query.query }),
        ...(request.query.year === undefined
          ? {}
          : { year: request.query.year }),
        ...(request.query.status === undefined
          ? {}
          : { status: request.query.status }),
        ...(request.query.lifecycle === undefined
          ? {}
          : { lifecycle: request.query.lifecycle }),
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20
      };
      return services.projectService.listProjects(principal, filters);
    }
  );

  app.post<{
    Body: { project: ProjectInput; ownerUserId: string };
  }>(
    "/api/v1/projects",
    {
      schema: {
        body: createProjectBodySchema,
        response: { ...apiErrorResponseSchemas, 201: projectDetailsSchema }
      }
    },
    async (request, reply) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      const result = await services.projectService.createProject(
        principal,
        request.body
      );
      reply.code(201).send(result);
    }
  );

  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:projectId",
    {
      schema: {
        params: projectParamsSchema,
        response: { ...apiErrorResponseSchemas, 200: projectDetailsSchema }
      }
    },
    async (request) =>
      services.projectService.getProject(
        await authenticate(request, config, services),
        request.params.projectId
      )
  );

  app.patch<{ Params: ProjectParams; Body: ProjectInput }>(
    "/api/v1/projects/:projectId",
    {
      schema: {
        params: projectParamsSchema,
        body: projectInputSchema,
        response: { ...apiErrorResponseSchemas, 200: projectDetailsSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      return services.projectService.updateProject(
        principal,
        request.params.projectId,
        request.body
      );
    }
  );

  app.post<{ Params: ProjectParams; Body: Record<string, never> }>(
    "/api/v1/projects/:projectId/archive",
    {
      preValidation: allowMissingBody,
      schema: {
        params: projectParamsSchema,
        body: emptyObjectSchema,
        response: { ...apiErrorResponseSchemas, 200: projectDetailsSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      return services.projectService.archiveProject(
        principal,
        request.params.projectId
      );
    }
  );

  app.post<{ Params: ProjectParams; Body: Record<string, never> }>(
    "/api/v1/projects/:projectId/restore",
    {
      preValidation: allowMissingBody,
      schema: {
        params: projectParamsSchema,
        body: emptyObjectSchema,
        response: { ...apiErrorResponseSchemas, 200: projectDetailsSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      return services.projectService.restoreProject(
        principal,
        request.params.projectId
      );
    }
  );

  app.get<{ Params: ProjectParams; Querystring: PaginationQuery }>(
    "/api/v1/projects/:projectId/audit-events",
    {
      schema: {
        params: projectParamsSchema,
        querystring: paginationQuerySchema,
        response: { ...apiErrorResponseSchemas, 200: auditPageSchema }
      }
    },
    async (request) =>
      services.projectService.listAuditEvents(
        await authenticate(request, config, services),
        request.params.projectId,
        request.query.page ?? 1,
        request.query.pageSize ?? 20
      )
  );

  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:projectId/members",
    {
      schema: {
        params: projectParamsSchema,
        response: {
          ...apiErrorResponseSchemas,
          200: { type: "array", items: memberViewSchema }
        }
      }
    },
    async (request) =>
      services.memberService.listMembers(
        await authenticate(request, config, services),
        request.params.projectId
      )
  );

  app.get<{ Params: ProjectParams; Querystring: { query: string } }>(
    "/api/v1/projects/:projectId/member-candidates",
    {
      schema: {
        params: projectParamsSchema,
        querystring: candidateQuerySchema,
        response: { ...apiErrorResponseSchemas, 200: candidateResultsSchema }
      }
    },
    async (request) =>
      services.memberService.searchCandidates(
        await authenticate(request, config, services),
        request.params.projectId,
        request.query.query
      )
  );

  app.post<{ Params: ProjectParams; Body: AddMemberInput }>(
    "/api/v1/projects/:projectId/members",
    {
      schema: {
        params: projectParamsSchema,
        body: addMemberBodySchema,
        response: { ...apiErrorResponseSchemas, 201: memberViewSchema }
      }
    },
    async (request, reply) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      const result = await services.memberService.addMember(
        principal,
        request.params.projectId,
        request.body
      );
      reply.code(201).send(result);
    }
  );

  app.patch<{
    Params: ProjectMemberParams;
    Body: MemberInput;
  }>(
    "/api/v1/projects/:projectId/members/:memberId",
    {
      schema: {
        params: projectMemberParamsSchema,
        body: memberInputSchema,
        response: { ...apiErrorResponseSchemas, 200: memberViewSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      return services.memberService.updateMember(
        principal,
        request.params.projectId,
        request.params.memberId,
        request.body
      );
    }
  );

  app.delete<{
    Params: ProjectMemberParams;
    Body: Record<string, never>;
  }>(
    "/api/v1/projects/:projectId/members/:memberId",
    {
      preValidation: allowMissingBody,
      schema: {
        params: projectMemberParamsSchema,
        body: emptyObjectSchema,
        response: apiErrorResponseSchemas
      }
    },
    async (request, reply) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      await services.memberService.removeMember(
        principal,
        request.params.projectId,
        request.params.memberId
      );
      reply.code(204).send();
    }
  );
}
