import { describe, expect, it } from "vitest";

import { resolveWebConfig } from "./config.js";

describe("resolveWebConfig", () => {
  it.each([undefined, "", "   "])(
    "reports a missing API address for %j",
    (apiBaseUrl) => {
      expect(resolveWebConfig(apiBaseUrl)).toEqual({
        ok: false,
        message: "API 地址未配置"
      });
    }
  );

  it("normalizes a relative API address", () => {
    expect(resolveWebConfig("/api/")).toEqual({
      ok: true,
      apiBaseUrl: "/api"
    });
  });

  it("accepts and normalizes an HTTPS API address", () => {
    expect(resolveWebConfig("https://service.example.test/api/")).toEqual({
      ok: true,
      apiBaseUrl: "https://service.example.test/api"
    });
  });

  it.each(["api", "ftp://service.example.test/api"])(
    "rejects invalid API address %j",
    (apiBaseUrl) => {
      expect(resolveWebConfig(apiBaseUrl)).toEqual({
        ok: false,
        message: "API 地址格式无效"
      });
    }
  );
});
