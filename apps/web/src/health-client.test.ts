import { SYSTEM_VERSION } from "@project-online/domain";
import { describe, expect, it, vi } from "vitest";

import { checkApiHealth } from "./health-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("checkApiHealth", () => {
  it("returns service details for a compatible response", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(
      jsonResponse({
        status: "ok",
        service: "api",
        environment: "development",
        systemVersion: SYSTEM_VERSION
      })
    );

    await expect(checkApiHealth("/api", fetchImpl)).resolves.toEqual({
      ok: true,
      service: "api",
      systemVersion: SYSTEM_VERSION
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/health", {
      headers: { accept: "application/json" }
    });
  });

  it("returns a network failure when fetch rejects", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockRejectedValue(new Error("offline"));

    await expect(checkApiHealth("/api", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "network",
      message: "无法连接 API"
    });
  });

  it("rejects a non-success response", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(jsonResponse({ message: "unavailable" }, 503));

    await expect(checkApiHealth("/api", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "response",
      message: "API 响应无效"
    });
  });

  it("rejects an invalid response structure", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(jsonResponse({ status: "ok" }));

    await expect(checkApiHealth("/api", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "response",
      message: "API 响应无效"
    });
  });

  it("rejects a different system version", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(
      jsonResponse({
        status: "ok",
        service: "api",
        environment: "development",
        systemVersion: "9.9.9"
      })
    );

    await expect(checkApiHealth("/api", fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "version",
      message: "API 版本不一致"
    });
  });
});
