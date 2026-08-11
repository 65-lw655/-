import { describe, expect, it } from "vitest";

import { parseApiConfig } from "./config.js";

describe("parseApiConfig", () => {
  it("uses safe development defaults", () => {
    expect(parseApiConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      environment: "development",
      webOrigin: "http://127.0.0.1:5173",
      authStorePath: ".local-data/auth-store.json"
    });
  });

  it("accepts valid runtime configuration", () => {
    expect(
      parseApiConfig({
        API_HOST: "0.0.0.0",
        API_PORT: "4100",
        APP_ENV: "production",
        WEB_ORIGIN: "https://projects.example.com",
        AUTH_STORE_PATH: "runtime/auth.json"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 4100,
      environment: "production",
      webOrigin: "https://projects.example.com",
      authStorePath: "runtime/auth.json"
    });
  });

  it.each(["", "0", "65536", "1.5", "invalid"])(
    "rejects invalid API_PORT value %j",
    (port) => {
      expect(() => parseApiConfig({ API_PORT: port })).toThrow(
        "API_PORT must be an integer between 1 and 65535"
      );
    }
  );

  it("rejects an unsupported APP_ENV", () => {
    expect(() => parseApiConfig({ APP_ENV: "staging" })).toThrow(
      "APP_ENV must be development, test, or production"
    );
  });

  it("uses the default host when API_HOST is blank", () => {
    expect(parseApiConfig({ API_HOST: "   " }).host).toBe("127.0.0.1");
  });

  it.each([
    "ftp://projects.example.com",
    "https://projects.example.com/path",
    "https://projects.example.com?preview=1",
    "https://projects.example.com#section",
    "not-an-origin"
  ])("rejects invalid WEB_ORIGIN value %j", (webOrigin) => {
    expect(() => parseApiConfig({ WEB_ORIGIN: webOrigin })).toThrow(
      "WEB_ORIGIN must be an HTTP(S) origin without path, query, or hash"
    );
  });

  it("rejects an empty AUTH_STORE_PATH", () => {
    expect(() => parseApiConfig({ AUTH_STORE_PATH: "   " })).toThrow(
      "AUTH_STORE_PATH must not be empty"
    );
  });
});
