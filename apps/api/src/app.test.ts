import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYSTEM_VERSION } from "@project-online/domain";
import type { FastifyInstance, FastifyListenOptions } from "fastify";
import { describe, expect, it, vi } from "vitest";

import * as appModule from "./app.js";
import { buildApp } from "./app.js";
import { createRuntimeServices } from "./runtime.js";

type ListenWithCleanup = (
  app: FastifyInstance,
  options: FastifyListenOptions
) => Promise<string>;

function requestedListenWithCleanup(): ListenWithCleanup | undefined {
  return (
    appModule as typeof appModule & {
      listenWithCleanup?: ListenWithCleanup;
    }
  ).listenWithCleanup;
}

describe("GET /api/v1/health", () => {
  it("returns the API status and shared system version", async () => {
    const app = buildApp({
      host: "127.0.0.1",
      port: 3000,
      environment: "test",
      webOrigin: "http://127.0.0.1:5173",
      authStorePath: ".local-data/auth-store.json",
      databaseUrl: "not-used-by-unit-tests"
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
          authStorePath: join(storeDirectory, "state.json"),
          databaseUrl: "not-used-by-unit-tests"
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

describe("listenWithCleanup", () => {
  it("closes once and rethrows the original listen error", async () => {
    const listenError = new Error("fictional listen failure");
    const app = {
      listen: vi.fn(async () => {
        throw listenError;
      }),
      close: vi.fn(async () => undefined)
    } as unknown as FastifyInstance;
    const listenWithCleanup = requestedListenWithCleanup();

    expect(listenWithCleanup).toBeTypeOf("function");
    if (listenWithCleanup === undefined) {
      return;
    }

    let caught: unknown;
    try {
      await listenWithCleanup(app, { port: 3000 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(listenError);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the listen error when close also fails", async () => {
    const listenError = new Error("fictional listen failure");
    const app = {
      listen: vi.fn(async () => {
        throw listenError;
      }),
      close: vi.fn(async () => {
        throw new Error("private cleanup detail");
      })
    } as unknown as FastifyInstance;
    const listenWithCleanup = requestedListenWithCleanup();

    expect(listenWithCleanup).toBeTypeOf("function");
    if (listenWithCleanup === undefined) {
      return;
    }

    let caught: unknown;
    try {
      await listenWithCleanup(app, { port: 3000 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(listenError);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("does not close after listen succeeds", async () => {
    const app = {
      listen: vi.fn(async () => "http://127.0.0.1:3000"),
      close: vi.fn(async () => undefined)
    } as unknown as FastifyInstance;
    const listenWithCleanup = requestedListenWithCleanup();

    expect(listenWithCleanup).toBeTypeOf("function");
    if (listenWithCleanup === undefined) {
      return;
    }

    await expect(listenWithCleanup(app, { port: 3000 })).resolves.toBe(
      "http://127.0.0.1:3000"
    );
    expect(app.close).not.toHaveBeenCalled();
  });
});
