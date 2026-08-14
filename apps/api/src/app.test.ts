import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYSTEM_VERSION } from "@project-online/domain";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { createRuntimeServices } from "./runtime.js";

describe("GET /api/v1/health", () => {
  it("returns the API status and shared system version", async () => {
    const app = buildApp({
      host: "127.0.0.1",
      port: 3000,
      environment: "test",
      webOrigin: "http://127.0.0.1:5173",
      authStorePath: ".local-data/auth-store.json"
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

describe("createRuntimeServices", () => {
  it("rejects production before opening the file authentication store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "project-online-runtime-"));
    const storeDirectory = join(directory, "auth");

    try {
      await expect(
        createRuntimeServices({
          host: "127.0.0.1",
          port: 3000,
          environment: "production",
          webOrigin: "https://projects.example.test",
          authStorePath: join(storeDirectory, "state.json")
        })
      ).rejects.toThrow("Production authentication store is not configured");
      await expect(access(storeDirectory)).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
