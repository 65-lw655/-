import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { nodePasswordHasher, validatePassword } from "./password.js";

function makeTestPassword(): string {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}

function makePasswordWithCodePoints(length: number): string {
  let generated = makeTestPassword();

  while (Array.from(generated).length < length) {
    generated += makeTestPassword();
  }

  const codePoints = Array.from(generated).slice(0, length);
  codePoints[0] = String.fromCodePoint(0x1f642);
  return codePoints.join("");
}

describe("validatePassword", () => {
  it("accepts the 12 Unicode code point lower boundary", () => {
    expect(validatePassword(makePasswordWithCodePoints(12))).toEqual({
      valid: true
    });
  });

  it("rejects fewer than 12 Unicode code points", () => {
    expect(validatePassword(makePasswordWithCodePoints(11))).toEqual({
      valid: false,
      reason: "PASSWORD_TOO_SHORT"
    });
  });

  it("accepts the 128 Unicode code point upper boundary", () => {
    expect(validatePassword(makePasswordWithCodePoints(128))).toEqual({
      valid: true
    });
  });

  it("rejects more than 128 Unicode code points", () => {
    expect(validatePassword(makePasswordWithCodePoints(129))).toEqual({
      valid: false,
      reason: "PASSWORD_TOO_LONG"
    });
  });

  it("rejects an all-whitespace password as required", () => {
    const whitespace = String.fromCodePoint(32).repeat(
      Array.from(makeTestPassword()).length
    );

    expect(validatePassword(whitespace)).toEqual({
      valid: false,
      reason: "PASSWORD_REQUIRED"
    });
  });
});

describe("nodePasswordHasher", () => {
  it("produces distinct versioned hashes for the same password", async () => {
    const password = makeTestPassword();

    const first = await nodePasswordHasher.hash(password);
    const second = await nodePasswordHasher.hash(password);

    expect(first).toMatch(
      /^scrypt\$v=1\$N=131072,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/
    );
    expect(second).not.toBe(first);
  });

  it("accepts the correct password", async () => {
    const password = makeTestPassword();
    const encoded = await nodePasswordHasher.hash(password);

    await expect(nodePasswordHasher.verify(password, encoded)).resolves.toBe(
      true
    );
  });

  it("rejects another random password", async () => {
    const encoded = await nodePasswordHasher.hash(makeTestPassword());

    await expect(
      nodePasswordHasher.verify(makeTestPassword(), encoded)
    ).resolves.toBe(false);
  });

  it("safely rejects damaged encoded hash fields", async () => {
    const password = makeTestPassword();
    const encoded = await nodePasswordHasher.hash(password);
    const parts = encoded.split("$");
    const damagedValues = [
      encoded.replace("scrypt$", "damaged$"),
      encoded.replace("$v=1$", "$v=2$"),
      encoded.replace("$N=131072,r=8,p=1$", "$N=65536,r=8,p=1$"),
      [
        parts[0],
        parts[1],
        parts[2],
        randomBytes(15).toString("base64url"),
        parts[4]
      ].join("$"),
      [
        parts[0],
        parts[1],
        parts[2],
        parts[3],
        randomBytes(63).toString("base64url")
      ].join("$")
    ];

    for (const damaged of damagedValues) {
      await expect(nodePasswordHasher.verify(password, damaged)).resolves.toBe(
        false
      );
    }
  });
});
