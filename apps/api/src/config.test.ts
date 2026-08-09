import { describe, expect, it } from "vitest";

import { parseApiConfig } from "./config.js";

describe("parseApiConfig", () => {
  it("uses safe development defaults", () => {
    expect(parseApiConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      environment: "development"
    });
  });

  it("accepts valid runtime configuration", () => {
    expect(
      parseApiConfig({
        API_HOST: "0.0.0.0",
        API_PORT: "4100",
        APP_ENV: "production"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 4100,
      environment: "production"
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
});
