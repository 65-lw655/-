import { describe, expect, it, vi } from "vitest";

import {
  createCredentialStore,
  type CredentialStatus
} from "./credential-store.js";
import type { Invoke } from "./desktop-bridge.js";

function invokeReturning(value: unknown): {
  invoke: Invoke;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn((command: string, args?: Record<string, unknown>) =>
    Promise.resolve(value)
  );
  return {
    invoke: <T>(command: string, args?: Record<string, unknown>) =>
      (args === undefined ? spy(command) : spy(command, args)) as Promise<T>,
    spy
  };
}

function installForbiddenPersistenceSpies() {
  const calls: string[] = [];
  const fail = (name: string) =>
    vi.fn(() => {
      calls.push(name);
      throw new Error(`${name} must not be used for credentials`);
    });

  vi.stubGlobal("localStorage", {
    getItem: fail("localStorage.getItem"),
    setItem: fail("localStorage.setItem"),
    removeItem: fail("localStorage.removeItem")
  });
  vi.stubGlobal("sessionStorage", {
    getItem: fail("sessionStorage.getItem"),
    setItem: fail("sessionStorage.setItem"),
    removeItem: fail("sessionStorage.removeItem")
  });
  vi.stubGlobal("indexedDB", {
    open: fail("indexedDB.open"),
    deleteDatabase: fail("indexedDB.deleteDatabase")
  });

  return calls;
}

describe("credential store", () => {
  it.each<CredentialStatus>(["PRESENT", "MISSING", "UNAVAILABLE"])(
    "reads credential status %s from the desktop command",
    async (status) => {
      const { invoke, spy } = invokeReturning(status);
      const store = createCredentialStore(invoke);

      await expect(store.status()).resolves.toBe(status);

      expect(spy).toHaveBeenCalledWith("credential_status");
    }
  );

  it("saves and deletes only through desktop commands", async () => {
    const secret = "fictional-session-value";
    const spy = vi.fn((command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(command === "delete_credential" ? "MISSING" : "PRESENT")
    );
    const invoke: Invoke = <T>(
      command: string,
      args?: Record<string, unknown>
    ) => (args === undefined ? spy(command) : spy(command, args)) as Promise<T>;
    const store = createCredentialStore(invoke);

    await expect(store.save(secret)).resolves.toBe("PRESENT");
    await expect(store.delete()).resolves.toBe("MISSING");

    expect(spy).toHaveBeenNthCalledWith(1, "save_credential", {
      input: { credential: secret }
    });
    expect(spy).toHaveBeenNthCalledWith(2, "delete_credential");
  });

  it("does not use browser storage or local persistence APIs", async () => {
    const persistenceCalls = installForbiddenPersistenceSpies();
    const { invoke } = invokeReturning("MISSING");
    const store = createCredentialStore(invoke);

    await store.status();
    await store.save("fictional-session-value");
    await store.delete();

    expect(persistenceCalls).toEqual([]);
  });
});
