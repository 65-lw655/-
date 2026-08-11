import { createHmac, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { ApiConfig } from "../../config.js";
import { MemoryAuthStateStore } from "../../storage/memory-auth-state-store.js";
import { UserService } from "../users/user-service.js";
import { AuthService } from "./auth-service.js";
import type { PasswordHasher } from "./password.js";

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

async function createHarness(environment: ApiConfig["environment"] = "test") {
  const store = new MemoryAuthStateStore();
  const passwordHasher = createHasher();
  const dummyPasswordHash = await passwordHasher.hash(runtimePassword());
  const authService = new AuthService(store, dummyPasswordHash, {
    passwordHasher
  });
  const userService = new UserService(store, { passwordHasher });
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 3000,
    environment,
    webOrigin: "https://web.example.test",
    authStorePath: ".local-data/auth-store.json"
  };
  const app = buildApp(config, { authService, userService });
  return { app, authService, userService, config };
}

async function bootstrapAndLogin(
  harness: Awaited<ReturnType<typeof createHarness>>
) {
  const password = runtimePassword();
  const username = `admin-${randomUUID()}`;
  const user = await harness.userService.bootstrapAdmin({
    username,
    displayName: "Administrator",
    password
  });
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: harness.config.webOrigin },
    payload: { username, password, deviceName: "Browser" }
  });
  const setCookie = response.headers["set-cookie"] as string;
  return {
    user,
    password,
    cookie: setCookie.split(";", 1)[0] as string,
    setCookie
  };
}

describe("authentication HTTP API", () => {
  it("activates a pending account without returning credential data", async () => {
    const harness = await createHarness();
    try {
      const admin = await harness.userService.bootstrapAdmin({
        username: `admin-${randomUUID()}`,
        displayName: "Administrator",
        password: runtimePassword()
      });
      const issued = await harness.userService.createUser(
        { userId: admin.id, sessionId: randomUUID(), role: "ADMIN" },
        {
          username: `user-${randomUUID()}`,
          displayName: "New user",
          role: "USER"
        }
      );

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/activate",
        payload: { ticket: issued.ticket, password: runtimePassword() }
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await harness.app.close();
    }
  });

  it("sets the strict production session cookie on login", async () => {
    const harness = await createHarness("production");
    try {
      const session = await bootstrapAndLogin(harness);

      expect(session.setCookie).toContain("__Host-id=");
      expect(session.setCookie).toContain("HttpOnly");
      expect(session.setCookie).toContain("Secure");
      expect(session.setCookie).toContain("SameSite=Strict");
      expect(session.setCookie).toContain("Path=/");
      expect(session.setCookie).not.toContain("Domain=");
      expect(session.setCookie).not.toContain(session.password);
    } finally {
      await harness.app.close();
    }
  });

  it("uses a non-Secure id cookie outside production", async () => {
    const harness = await createHarness("development");
    try {
      const session = await bootstrapAndLogin(harness);

      expect(session.setCookie).toContain("id=");
      expect(session.setCookie).not.toContain("__Host-id=");
      expect(session.setCookie).not.toContain("Secure");
    } finally {
      await harness.app.close();
    }
  });

  it("returns the authenticated identity from the session cookie", async () => {
    const harness = await createHarness();
    try {
      const session = await bootstrapAndLogin(harness);
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/auth/session",
        headers: { cookie: session.cookie }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        userId: session.user.id,
        role: "ADMIN"
      });
    } finally {
      await harness.app.close();
    }
  });

  it("rotates the cookie on refresh and rejects the old cookie", async () => {
    const harness = await createHarness();
    try {
      const session = await bootstrapAndLogin(harness);
      const refresh = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: {
          cookie: session.cookie,
          origin: harness.config.webOrigin
        }
      });
      const rotatedCookie = (refresh.headers["set-cookie"] as string).split(
        ";",
        1
      )[0] as string;

      expect(refresh.statusCode).toBe(204);
      expect(refresh.headers["cache-control"]).toBe("no-store");
      expect(rotatedCookie).not.toBe(session.cookie);
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: "/api/v1/auth/session",
            headers: { cookie: session.cookie }
          })
        ).statusCode
      ).toBe(401);
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: "/api/v1/auth/session",
            headers: { cookie: rotatedCookie }
          })
        ).statusCode
      ).toBe(200);
    } finally {
      await harness.app.close();
    }
  });

  it("logs out the current session and clears its cookie", async () => {
    const harness = await createHarness();
    try {
      const session = await bootstrapAndLogin(harness);
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: {
          cookie: session.cookie,
          origin: harness.config.webOrigin
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["set-cookie"]).toContain("id=;");
      expect(response.headers["set-cookie"]).toContain("Path=/");
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: "/api/v1/auth/session",
            headers: { cookie: session.cookie }
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await harness.app.close();
    }
  });

  it("changes a password and rotates the current cookie", async () => {
    const harness = await createHarness();
    try {
      const session = await bootstrapAndLogin(harness);
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/password/change",
        headers: {
          cookie: session.cookie,
          origin: harness.config.webOrigin
        },
        payload: {
          currentPassword: session.password,
          newPassword: runtimePassword()
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["set-cookie"]).toBeTypeOf("string");
      expect(response.headers["set-cookie"]).not.toContain(session.cookie);
    } finally {
      await harness.app.close();
    }
  });

  it("completes a password reset without returning credential data", async () => {
    const harness = await createHarness();
    try {
      const admin = await harness.userService.bootstrapAdmin({
        username: `admin-${randomUUID()}`,
        displayName: "Administrator",
        password: runtimePassword()
      });
      const principal = {
        userId: admin.id,
        sessionId: randomUUID(),
        role: "ADMIN" as const
      };
      const created = await harness.userService.createUser(principal, {
        username: `user-${randomUUID()}`,
        displayName: "Reset user",
        role: "USER"
      });
      await harness.userService.activate({
        ticket: created.ticket,
        password: runtimePassword()
      });
      const reset = await harness.userService.issuePasswordReset(
        principal,
        created.user.id
      );

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/password-reset/complete",
        payload: { ticket: reset.ticket, password: runtimePassword() }
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await harness.app.close();
    }
  });

  it("returns stable errors and rejects extra request fields", async () => {
    const harness = await createHarness();
    try {
      const invalidLogin = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: harness.config.webOrigin },
        payload: {
          username: `missing-${randomUUID()}`,
          password: runtimePassword(),
          deviceName: "Browser"
        }
      });
      expect(invalidLogin.statusCode).toBe(401);
      expect(invalidLogin.json().code).toBe("INVALID_CREDENTIALS");

      const wrongOrigin = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "https://other.example.test" },
        payload: {
          username: `missing-${randomUUID()}`,
          password: runtimePassword(),
          deviceName: "Browser"
        }
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json().code).toBe("FORBIDDEN");

      const extraField = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/activate",
        payload: {
          ticket: randomUUID(),
          password: runtimePassword(),
          userId: randomUUID()
        }
      });
      expect(extraField.statusCode).toBe(400);
      expect(extraField.json().code).toBe("VALIDATION_ERROR");
    } finally {
      await harness.app.close();
    }
  });
});
