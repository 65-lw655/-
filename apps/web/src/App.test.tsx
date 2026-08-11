// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { SYSTEM_VERSION } from "@project-online/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
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

function sessionResponse(role: "USER" | "LEADER" | "ADMIN"): Response {
  return new Response(JSON.stringify({ userId: crypto.randomUUID(), role }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function authenticationFailure(): Response {
  return new Response(
    JSON.stringify({ code: "SESSION_EXPIRED", message: "会话已失效" }),
    {
      status: 401,
      headers: { "content-type": "application/json" }
    }
  );
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function managedUser() {
  return {
    id: crypto.randomUUID(),
    username: `admin-view-${crypto.randomUUID()}`,
    displayName: "管理员视图用户",
    role: "USER",
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    createdAt: "2026-08-11T08:00:00.000Z",
    updatedAt: "2026-08-11T08:00:00.000Z"
  };
}

function makePassword(): string {
  return `P${crypto.randomUUID()}!`;
}

function fillLoginForm(): void {
  fireEvent.change(screen.getByLabelText("用户名"), {
    target: { value: "member" }
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: makePassword() }
  });
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

  it("checks the session before choosing the initial view", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    let resolveSession: ((response: Response) => void) | undefined;
    fetchImpl.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        })
    );

    render(
      <App apiBaseUrl="/api" environment="development" fetchImpl={fetchImpl} />
    );

    expect(screen.getByText("正在恢复会话")).toBeInTheDocument();

    resolveSession?.(authenticationFailure());
    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("shows login when there is no authenticated session", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(authenticationFailure());

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("switches anonymous entry modes", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(authenticationFailure());

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "登录" });
    fireEvent.click(screen.getByRole("button", { name: "使用激活码设置密码" }));
    expect(screen.getByRole("heading", { name: "激活账户" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "使用重置码设置新密码" }));
    expect(screen.getByRole("heading", { name: "重设密码" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it.each([
    ["激活", "使用激活码设置密码", "激活账户", "/auth/activate"],
    ["重置", "使用重置码设置新密码", "重设密码", "/auth/password-reset/complete"]
  ] as const)(
    "completes %s from the anonymous entry flow",
    async (_, entryLabel, title, path) => {
      const ticket = crypto.randomUUID();
      const password = makePassword();
      const fetchImpl = vi.fn<typeof fetch>();
      fetchImpl.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/auth/session")) {
          return authenticationFailure();
        }
        if (url.endsWith(path)) {
          return noContentResponse();
        }
        return healthResponse();
      });

      render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

      await screen.findByRole("heading", { name: "登录" });
      fireEvent.click(screen.getByRole("button", { name: entryLabel }));
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("一次性码"), {
        target: { value: ticket }
      });
      fireEvent.change(screen.getByLabelText("新密码"), {
        target: { value: password }
      });
      fireEvent.change(screen.getByLabelText("确认新密码"), {
        target: { value: password }
      });
      fireEvent.click(screen.getByRole("button", { name: "设置密码" }));

      expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
      expect(fetchImpl).toHaveBeenCalledWith(`/api/v1${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ ticket, password })
      });
    }
  );

  it("shows the account after successful login and preserves runtime information", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(authenticationFailure())
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(sessionResponse("LEADER"))
      .mockResolvedValue(healthResponse());

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "登录" });
    fillLoginForm();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "账户" })).toBeInTheDocument();
    expect(screen.getByText("LEADER")).toBeInTheDocument();
    expect(await screen.findAllByText("已连接")).toHaveLength(2);
    expect(screen.getAllByText(SYSTEM_VERSION)).toHaveLength(2);
  });

  it("returns to login when an authenticated request receives 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/auth/logout")) {
        return authenticationFailure();
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "账户" });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByText("会话已失效，请重新登录")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("clears the user after logout", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/auth/logout")) {
        return noContentResponse();
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "账户" });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.queryByText("USER")).not.toBeInTheDocument();
  });

  it("renders user management with a valid user list for administrators", async () => {
    const user = managedUser();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("ADMIN");
      }
      if (url.endsWith("/v1/users")) {
        return new Response(JSON.stringify([user]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    const adminUsersView = await screen.findByRole("region", { name: "用户管理" });
    expect(screen.getByRole("link", { name: "用户管理" })).toBeInTheDocument();
    expect(within(adminUsersView).getByRole("table")).toBeInTheDocument();
    expect(await within(adminUsersView).findByText(user.username)).toBeInTheDocument();
  });

  it.each(["USER", "LEADER"] as const)(
    "does not show user management to %s",
    async (role) => {
      const fetchImpl = vi.fn<typeof fetch>();
      fetchImpl.mockImplementation(async (input) => {
        return String(input).endsWith("/auth/session")
          ? sessionResponse(role)
          : healthResponse();
      });

      render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

      await screen.findByRole("heading", { name: "账户" });
      expect(screen.queryByRole("link", { name: "用户管理" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "用户管理" })).not.toBeInTheDocument();
    }
  );

  it("shows a version mismatch in the authenticated toolbar", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      return String(input).endsWith("/auth/session")
        ? sessionResponse("USER")
        : healthResponse("9.9.9");
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getAllByText("版本不一致")).toHaveLength(2);
    });
  });
});
