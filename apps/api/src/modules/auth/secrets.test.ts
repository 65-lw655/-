import { describe, expect, it } from "vitest";

import { digestOpaqueSecret, generateOpaqueSecret } from "./secrets.js";

describe("generateOpaqueSecret", () => {
  it("generates 100 non-empty unique secrets", () => {
    const secrets = Array.from({ length: 100 }, generateOpaqueSecret);

    expect(secrets.every((secret) => secret.length > 0)).toBe(true);
    expect(new Set(secrets)).toHaveLength(100);
  });
});

describe("digestOpaqueSecret", () => {
  it("returns a stable digest", () => {
    const secret = generateOpaqueSecret();

    expect(digestOpaqueSecret(secret)).toBe(digestOpaqueSecret(secret));
  });

  it("returns different digests for different secrets", () => {
    const first = generateOpaqueSecret();
    const second = generateOpaqueSecret();

    expect(digestOpaqueSecret(first)).not.toBe(digestOpaqueSecret(second));
  });

  it("does not include the original secret", () => {
    const secret = generateOpaqueSecret();

    expect(digestOpaqueSecret(secret)).not.toContain(secret);
  });
});
