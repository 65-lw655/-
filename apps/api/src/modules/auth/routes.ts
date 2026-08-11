import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiConfig } from "../../config.js";
import { ServiceError, type UserService } from "../users/user-service.js";
import { AuthServiceError, type AuthService } from "./auth-service.js";

export interface ApiServices {
  authService: AuthService;
  userService: UserService;
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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

function cookieName(config: ApiConfig): "__Host-id" | "id" {
  return config.environment === "production" ? "__Host-id" : "id";
}

function cookieOptions(config: ApiConfig) {
  return {
    httpOnly: true,
    secure: config.environment === "production",
    sameSite: "strict" as const,
    path: "/"
  };
}

export function assertSameOrigin(
  request: FastifyRequest,
  config: ApiConfig
): void {
  if (request.headers.origin !== config.webOrigin) {
    throw new ApiError(403, "FORBIDDEN", "Operation is not allowed");
  }
}

export function readSessionToken(
  request: FastifyRequest,
  config: ApiConfig
): string {
  const token = request.cookies[cookieName(config)];
  if (token === undefined || token.length === 0) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication is required"
    );
  }
  return token;
}

export function sendApiError(error: unknown, reply: FastifyReply): void {
  if (error instanceof ApiError) {
    reply
      .code(error.statusCode)
      .send({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof AuthServiceError) {
    const code =
      error.code === "INVALID_SESSION" ? "SESSION_EXPIRED" : error.code;
    reply.code(error.statusCode).send({ code, message: error.message });
    return;
  }
  if (error instanceof ServiceError) {
    reply
      .code(error.statusCode)
      .send({ code: error.code, message: error.message });
    return;
  }
  throw error;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  services: ApiServices
): void {
  app.post<{ Body: { ticket: string; password: string } }>(
    "/api/v1/auth/activate",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ticket", "password"],
          properties: { ticket: stringProperty, password: stringProperty }
        }
      }
    },
    async (request, reply) => {
      await services.userService.activate(request.body);
      reply.header("Cache-Control", "no-store").code(204).send();
    }
  );

  app.post<{
    Body: { username: string; password: string; deviceName: string };
  }>(
    "/api/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password", "deviceName"],
          properties: {
            username: stringProperty,
            password: stringProperty,
            deviceName: stringProperty
          }
        }
      }
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const session = await services.authService.login({
        ...request.body,
        sourceAddress: request.ip
      });
      reply
        .setCookie(cookieName(config), session.token, {
          ...cookieOptions(config),
          expires: new Date(session.expiresAt)
        })
        .header("Cache-Control", "no-store")
        .code(204)
        .send();
    }
  );

  app.post(
    "/api/v1/auth/refresh",
    { preValidation: allowMissingBody, schema: { body: emptyObjectSchema } },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const session = await services.authService.refresh(
        readSessionToken(request, config)
      );
      reply
        .setCookie(cookieName(config), session.token, {
          ...cookieOptions(config),
          expires: new Date(session.expiresAt)
        })
        .header("Cache-Control", "no-store")
        .code(204)
        .send();
    }
  );

  app.post<{ Body: { ticket: string; password: string } }>(
    "/api/v1/auth/password-reset/complete",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ticket", "password"],
          properties: { ticket: stringProperty, password: stringProperty }
        }
      }
    },
    async (request, reply) => {
      await services.userService.completePasswordReset(request.body);
      reply.header("Cache-Control", "no-store").code(204).send();
    }
  );

  app.get("/api/v1/auth/session", async (request) => {
    const principal = await services.authService.authenticate(
      readSessionToken(request, config)
    );
    return { userId: principal.userId, role: principal.role };
  });

  app.post(
    "/api/v1/auth/logout",
    { preValidation: allowMissingBody, schema: { body: emptyObjectSchema } },
    async (request, reply) => {
      assertSameOrigin(request, config);
      await services.authService.logout(readSessionToken(request, config));
      reply
        .clearCookie(cookieName(config), cookieOptions(config))
        .code(204)
        .send();
    }
  );

  app.post<{
    Body: { currentPassword: string; newPassword: string };
  }>(
    "/api/v1/auth/password/change",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: stringProperty,
            newPassword: stringProperty
          }
        }
      }
    },
    async (request, reply) => {
      assertSameOrigin(request, config);
      const session = await services.authService.changePassword(
        readSessionToken(request, config),
        request.body.currentPassword,
        request.body.newPassword
      );
      reply
        .setCookie(cookieName(config), session.token, {
          ...cookieOptions(config),
          expires: new Date(session.expiresAt)
        })
        .header("Cache-Control", "no-store")
        .code(204)
        .send();
    }
  );
}
