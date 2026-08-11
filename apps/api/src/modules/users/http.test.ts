import { createHmac, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { ApiConfig } from "../../config.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { AuthService } from "../auth/auth-service.js";
import type { PasswordHasher } from "../auth/password.js";
import { UserService } from "./user-service.js";

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

async function createHarness() {
  const store = new MemoryAuthStateStore();
  const passwordHasher = createHasher();
  const authService = new AuthService(
    store,
    await passwordHasher.hash(runtimePassword()),
    { passwordHasher }
  );
  const userService = new UserService(store, { passwordHasher });
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 3000,
    environment: "test",
    webOrigin: "https://web.example.test",
    authStorePath: ".local-data/auth-store.json"
  };
  return {
    app: buildApp(config, { authService, userService }),
    config,
    userService
  };
}

async function login(
  harness: Awaited<ReturnType<typeof createHarness>>,
  username: string,
  password: string
): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: harness.config.webOrigin },
    payload: { username, password, deviceName: "Browser" }
  });
  expect(response.statusCode).toBe(204);
  return (response.headers["set-cookie"] as string).split(";", 1)[0] as string;
}

async function createAdmin(harness: Awaited<ReturnType<typeof createHarness>>) {
  const username = `admin-${randomUUID()}`;
  const password = runtimePassword();
  const user = await harness.userService.bootstrapAdmin({
    username,
    displayName: "Administrator",
    password
  });
  return { user, cookie: await login(harness, username, password) };
}

async function createReadyUser(
  harness: Awaited<ReturnType<typeof createHarness>>,
  adminId: string,
  role: "USER" | "LEADER" | "ADMIN" = "USER"
) {
  const username = `user-${randomUUID()}`;
  const password = runtimePassword();
  const created = await harness.userService.createUser(
    { userId: adminId, sessionId: randomUUID(), role: "ADMIN" },
    { username, displayName: "Project user", role }
  );
  await harness.userService.activate({ ticket: created.ticket, password });
  return {
    user: created.user,
    cookie: await login(harness, username, password)
  };
}

function expectNoStoredCredentialFields(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(
    /passwordHash|tokenHash|ticketDigest/
  );
}

describe("administrator user HTTP API", () => {
  it("lists users and creates a pending account with one activation ticket", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const createResponse = await harness.app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: {
          username: `new-${randomUUID()}`,
          displayName: "New user",
          role: "USER"
        }
      });
      expect(createResponse.statusCode).toBe(201);
      expect(createResponse.json()).toMatchObject({
        user: { role: "USER", credentialStatus: "PENDING_ACTIVATION" },
        ticket: expect.any(String),
        expiresAt: expect.any(String)
      });
      expect(createResponse.headers["cache-control"]).toBe("no-store");
      expectNoStoredCredentialFields(createResponse.json());

      const listResponse = await harness.app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: { cookie: admin.cookie }
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toHaveLength(2);
      expectNoStoredCredentialFields(listResponse.json());
    } finally {
      await harness.app.close();
    }
  });

  it("returns 401 without a session and 403 for a non-admin session", async () => {
    const harness = await createHarness();
    try {
      const unauthenticated = await harness.app.inject({
        method: "GET",
        url: "/api/v1/users"
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json().code).toBe("AUTHENTICATION_REQUIRED");

      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);
      const forbidden = await harness.app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: { cookie: regular.cookie }
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().code).toBe("FORBIDDEN");
    } finally {
      await harness.app.close();
    }
  });

  it("disables, enables, and changes a user's role", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);

      const disabled = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/disable`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        }
      });
      expect(disabled.statusCode).toBe(204);
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: "/api/v1/auth/session",
            headers: { cookie: regular.cookie }
          })
        ).statusCode
      ).toBe(401);

      const enabled = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/enable`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        }
      });
      expect(enabled.statusCode).toBe(204);

      const role = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/users/${regular.user.id}/role`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { role: "LEADER" }
      });
      expect(role.statusCode).toBe(200);
      expect(role.json()).toMatchObject({ id: regular.user.id, role: "LEADER" });
      expectNoStoredCredentialFields(role.json());
    } finally {
      await harness.app.close();
    }
  });

  it("reissues activation and issues password reset tickets", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const pending = await harness.userService.createUser(
        { userId: admin.user.id, sessionId: randomUUID(), role: "ADMIN" },
        {
          username: `pending-${randomUUID()}`,
          displayName: "Pending user",
          role: "USER"
        }
      );
      const activation = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${pending.user.id}/activation`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        }
      });
      expect(activation.statusCode).toBe(200);
      expect(activation.json().ticket).toEqual(expect.any(String));
      expect(activation.json().ticket).not.toBe(pending.ticket);
      expectNoStoredCredentialFields(activation.json());

      const ready = await createReadyUser(harness, admin.user.id);
      const reset = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${ready.user.id}/password-reset`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        }
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.json()).toMatchObject({
        user: { id: ready.user.id, credentialStatus: "RESET_REQUIRED" },
        ticket: expect.any(String),
        expiresAt: expect.any(String)
      });
      expectNoStoredCredentialFields(reset.json());
    } finally {
      await harness.app.close();
    }
  });

  it("protects the last active administrator", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${admin.user.id}/disable`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("LAST_ADMIN_REQUIRED");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects mismatched origins and extra role fields", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);
      const wrongOrigin = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/disable`,
        headers: {
          cookie: admin.cookie,
          origin: "https://other.example.test"
        }
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json().code).toBe("FORBIDDEN");

      const extraField = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/users/${regular.user.id}/role`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { role: "LEADER", actorRole: "ADMIN" }
      });
      expect(extraField.statusCode).toBe(400);
      expect(extraField.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects an unexpected JSON body when reissuing activation", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const pending = await harness.userService.createUser(
        { userId: admin.user.id, sessionId: randomUUID(), role: "ADMIN" },
        {
          username: `pending-${randomUUID()}`,
          displayName: "Pending user",
          role: "USER"
        }
      );

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${pending.user.id}/activation`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { unexpected: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects an unexpected JSON body when disabling a user", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/disable`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { unexpected: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects an unexpected JSON body when enabling a user", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);
      await harness.userService.disableUser(
        { userId: admin.user.id, sessionId: randomUUID(), role: "ADMIN" },
        regular.user.id
      );
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/enable`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { unexpected: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects an unexpected JSON body when issuing a password reset", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const regular = await createReadyUser(harness, admin.user.id);
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${regular.user.id}/password-reset`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin
        },
        payload: { unexpected: true }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });

  it("rejects a null JSON body when reissuing activation", async () => {
    const harness = await createHarness();
    try {
      const admin = await createAdmin(harness);
      const pending = await harness.userService.createUser(
        { userId: admin.user.id, sessionId: randomUUID(), role: "ADMIN" },
        {
          username: `pending-${randomUUID()}`,
          displayName: "Pending user",
          role: "USER"
        }
      );

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${pending.user.id}/activation`,
        headers: {
          cookie: admin.cookie,
          origin: harness.config.webOrigin,
          "content-type": "application/json"
        },
        payload: "null"
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });
});
