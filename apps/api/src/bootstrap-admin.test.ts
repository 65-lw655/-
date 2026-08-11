import { createHmac, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runBootstrapAdmin, type BootstrapPrompt } from "./bootstrap-admin.js";
import type { PasswordHasher } from "./modules/auth/password.js";
import { UserService } from "./modules/users/user-service.js";
import { MemoryAuthStateStore } from "./storage/memory-auth-state-store.js";

function runtimePassword(): string {
  return `${randomUUID()}Aa1!`;
}

function createHasher(): PasswordHasher {
  const key = randomUUID();
  const encode = (password: string) =>
    createHmac("sha256", key).update(password).digest("base64url");
  return {
    hash: async (password) => encode(password),
    verify: async (password, encoded) => encode(password) === encoded
  };
}

function createPrompt(password: string, confirmation: string): BootstrapPrompt {
  return {
    readUsername: async () => `admin-${randomUUID()}`,
    readDisplayName: async () => "Administrator",
    readHiddenPassword: async (label) =>
      label === "Password: " ? password : confirmation
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBootstrapAdmin", () => {
  it("rejects mismatched password confirmation without creating a user", async () => {
    const store = new MemoryAuthStateStore();
    const service = new UserService(store, { passwordHasher: createHasher() });

    await expect(
      runBootstrapAdmin(
        createPrompt(runtimePassword(), runtimePassword()),
        service
      )
    ).rejects.toThrow("Passwords do not match");
    expect(await store.read((state) => state.users)).toEqual([]);
  });

  it("rejects bootstrap when a user already exists", async () => {
    const store = new MemoryAuthStateStore();
    const service = new UserService(store, { passwordHasher: createHasher() });
    await service.bootstrapAdmin({
      username: `existing-${randomUUID()}`,
      displayName: "Existing administrator",
      password: runtimePassword()
    });
    const password = runtimePassword();

    await expect(
      runBootstrapAdmin(createPrompt(password, password), service)
    ).rejects.toMatchObject({ code: "BOOTSTRAP_NOT_ALLOWED" });
  });

  it("creates the first administrator without outputting credentials", async () => {
    const store = new MemoryAuthStateStore();
    const service = new UserService(store, { passwordHasher: createHasher() });
    const password = runtimePassword();
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runBootstrapAdmin(createPrompt(password, password), service);

    const storedUser = await store.read((state) => state.users[0]);
    const output = writes.join("");
    expect(output).toBe("Administrator created\n");
    expect(output).not.toContain(password);
    expect(output).not.toContain(storedUser?.passwordHash);
  });
});
