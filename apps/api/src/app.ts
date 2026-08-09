import { SYSTEM_VERSION } from "@project-online/domain";
import fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config.js";

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

export function buildApp(config: ApiConfig): FastifyInstance {
  const app = fastify({
    logger: config.environment !== "test"
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

  return app;
}
