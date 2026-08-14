import { SYSTEM_VERSION } from "@project-online/domain";
import cookie from "@fastify/cookie";
import fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config.js";
import {
  registerAuthRoutes,
  sendApiError,
  type ApiServices
} from "./modules/auth/routes.js";
import { registerUserRoutes } from "./modules/users/routes.js";

const healthSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["status", "service", "environment", "systemVersion"],
      properties: {
        status: { type: "string", const: "ok" },
        service: { type: "string", const: "api" },
        environment: {
          type: "string",
          enum: ["development", "test", "production"]
        },
        systemVersion: { type: "string" }
      }
    }
  }
} as const;

export function buildApp(
  config: ApiConfig,
  services?: ApiServices
): FastifyInstance {
  const app = fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logger:
      config.environment === "test"
        ? false
        : {
            base: undefined,
            serializers: {
              req: (request) => ({
                method: request.method,
                url: request.url
              }),
              res: (response) => ({ statusCode: response.statusCode })
            }
          }
  });

  app.register(cookie);

  app.setErrorHandler((error, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation !== undefined
    ) {
      reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: "Invalid request" });
      return;
    }

    try {
      sendApiError(error, reply);
    } catch {
      reply
        .code(500)
        .send({ code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  });

  app.get(
    "/api/v1/health",
    {
      schema: healthSchema
    },
    async () => ({
      status: "ok",
      service: "api",
      environment: config.environment,
      systemVersion: SYSTEM_VERSION
    })
  );

  if (services !== undefined) {
    registerAuthRoutes(app, config, services);
    registerUserRoutes(app, config, services);
  }

  return app;
}
