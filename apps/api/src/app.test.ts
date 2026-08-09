import { SYSTEM_VERSION } from "@project-online/domain";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

describe("GET /api/v1/health", () => {
  it("returns the API status and shared system version", async () => {
    const app = buildApp({
      host: "127.0.0.1",
      port: 3000,
      environment: "test"
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/health"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok",
        service: "api",
        environment: "test",
        systemVersion: SYSTEM_VERSION
      });
    } finally {
      await app.close();
    }
  });
});
