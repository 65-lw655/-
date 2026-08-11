import type { SystemRole } from "@project-online/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiConfig } from "../../config.js";
import {
  assertSameOrigin,
  readSessionToken,
  type ApiServices
} from "../auth/routes.js";
import type { AuthenticatedPrincipal } from "./user-service.js";

const stringProperty = { type: "string" } as const;
const emptyObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

async function allowMissingBody(request: FastifyRequest): Promise<void> {
  if (request.body === undefined) {
    request.body = {};
  }
}
const publicUserSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "username",
    "displayName",
    "role",
    "accountStatus",
    "credentialStatus",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: stringProperty,
    username: stringProperty,
    displayName: stringProperty,
    role: { type: "string", enum: ["USER", "LEADER", "ADMIN"] },
    accountStatus: { type: "string", enum: ["ACTIVE", "DISABLED"] },
    credentialStatus: {
      type: "string",
      enum: ["PENDING_ACTIVATION", "READY", "RESET_REQUIRED"]
    },
    createdAt: stringProperty,
    updatedAt: stringProperty
  }
} as const;
const issuedTicketSchema = {
  type: "object",
  additionalProperties: false,
  required: ["user", "ticket", "expiresAt"],
  properties: {
    user: publicUserSchema,
    ticket: stringProperty,
    expiresAt: stringProperty
  }
} as const;
const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: stringProperty }
} as const;

async function authenticate(
  request: FastifyRequest,
  config: ApiConfig,
  services: ApiServices
): Promise<AuthenticatedPrincipal> {
  return services.authService.authenticate(readSessionToken(request, config));
}

export function registerUserRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  services: ApiServices
): void {
  app.get(
    "/api/v1/users",
    {
      schema: {
        response: { 200: { type: "array", items: publicUserSchema } }
      }
    },
    async (request) =>
      services.userService.listUsers(
        await authenticate(request, config, services)
      )
  );

  app.post<{
    Body: { username: string; displayName: string; role: SystemRole };
  }>(
    "/api/v1/users",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "displayName", "role"],
          properties: {
            username: stringProperty,
            displayName: stringProperty,
            role: { type: "string", enum: ["USER", "LEADER", "ADMIN"] }
          }
        },
        response: { 201: issuedTicketSchema }
      }
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const issued = await services.userService.createUser(
        await authenticate(request, config, services),
        request.body
      );
      reply.header("Cache-Control", "no-store").code(201).send(issued);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/users/:id/activation",
    {
      schema: {
        params: idParamsSchema,
        body: emptyObjectSchema,
        response: { 200: issuedTicketSchema }
      },
      preValidation: allowMissingBody
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const issued = await services.userService.reissueActivation(
        await authenticate(request, config, services),
        request.params.id
      );
      reply.header("Cache-Control", "no-store").send(issued);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/users/:id/disable",
    {
      preValidation: allowMissingBody,
      schema: { params: idParamsSchema, body: emptyObjectSchema }
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      await services.userService.disableUser(
        await authenticate(request, config, services),
        request.params.id
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/users/:id/enable",
    {
      preValidation: allowMissingBody,
      schema: { params: idParamsSchema, body: emptyObjectSchema }
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      await services.userService.enableUser(
        await authenticate(request, config, services),
        request.params.id
      );
      reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string }; Body: { role: SystemRole } }>(
    "/api/v1/users/:id/role",
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: {
            role: { type: "string", enum: ["USER", "LEADER", "ADMIN"] }
          }
        },
        response: { 200: publicUserSchema }
      }
    },
    async (request) => {
      assertSameOrigin(request, config);
      return services.userService.changeRole(
        await authenticate(request, config, services),
        request.params.id,
        request.body.role
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/users/:id/password-reset",
    {
      schema: {
        params: idParamsSchema,
        body: emptyObjectSchema,
        response: { 200: issuedTicketSchema }
      },
      preValidation: allowMissingBody
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const issued = await services.userService.issuePasswordReset(
        await authenticate(request, config, services),
        request.params.id
      );
      reply.header("Cache-Control", "no-store").send(issued);
    }
  );
}
