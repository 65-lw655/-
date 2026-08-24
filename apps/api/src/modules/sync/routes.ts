import type {
  PullProjectsQuery,
  PullProjectsResponse,
  PushProjectsRequest,
  PushProjectsResponse
} from "@project-online/sync";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiConfig } from "../../config.js";
import {
  assertSameOrigin,
  readSessionToken,
  type ApiServices,
  type SyncApiService
} from "../auth/routes.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import {
  apiErrorResponseSchemas,
  pullProjectsQuerySchema,
  pullProjectsResponseSchema,
  pushProjectsRequestSchema,
  pushProjectsResponseSchema
} from "./schemas.js";

function authenticate(
  request: FastifyRequest,
  config: ApiConfig,
  services: ApiServices
): Promise<AuthenticatedPrincipal> {
  return services.authService.authenticate(readSessionToken(request, config));
}

export function registerSyncRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  services: ApiServices & { syncService: SyncApiService }
): void {
  app.post<{ Body: PushProjectsRequest; Reply: PushProjectsResponse }>(
    "/api/v1/sync/push",
    {
      schema: {
        body: pushProjectsRequestSchema,
        response: { ...apiErrorResponseSchemas, 200: pushProjectsResponseSchema }
      }
    },
    async (request) => {
      const principal = await authenticate(request, config, services);
      assertSameOrigin(request, config);
      return services.syncService.pushProjects(principal, request.body);
    }
  );

  app.get<{ Querystring: PullProjectsQuery; Reply: PullProjectsResponse }>(
    "/api/v1/sync/pull",
    {
      schema: {
        querystring: pullProjectsQuerySchema,
        response: { ...apiErrorResponseSchemas, 200: pullProjectsResponseSchema }
      }
    },
    async (request) =>
      services.syncService.pullProjects(
        await authenticate(request, config, services),
        request.query
      )
  );
}
