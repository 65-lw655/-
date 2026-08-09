// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { SYSTEM_VERSION } from "@project-online/domain";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

afterEach(() => {
  cleanup();
});

function healthResponse(systemVersion: string = SYSTEM_VERSION): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "api",
      environment: "development",
      systemVersion
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}

describe("App", () => {
  it("shows missing configuration without requesting the API", () => {
    const fetchImpl = vi.fn<typeof fetch>();

    render(
      <App apiBaseUrl="" environment="development" fetchImpl={fetchImpl} />
    );

    expect(screen.getByText("API 地址未配置")).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the connected API and shared version", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(healthResponse());

    render(
      <App apiBaseUrl="/api" environment="development" fetchImpl={fetchImpl} />
    );

    expect(screen.getByText("正在检查")).toBeInTheDocument();
    expect(await screen.findByText("已连接")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getAllByText(SYSTEM_VERSION)).toHaveLength(2);
  });

  it("shows a connection failure when the API is offline", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockRejectedValue(new Error("offline"));

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    expect(await screen.findByText("连接失败")).toBeInTheDocument();
    expect(screen.getByText("无法连接 API")).toBeInTheDocument();
  });

  it("shows a version mismatch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(healthResponse("9.9.9"));

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("版本不一致")).toBeInTheDocument();
    });
  });
});
