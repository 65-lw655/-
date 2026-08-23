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

function projectPageResponse(withProject = false): Response {
  const actorId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const project = {
    id: projectId,
    name: "App 接线项目",
    year: 2026,
    type: "展陈",
    status: "施工中",
    phase: "施工",
    filingStatus: "已备案",
    plannedCompletionDate: "2026-12-31",
    actualCompletionDate: null,
    lifecycle: "ACTIVE",
    createdAt: "2026-08-14T00:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-08-14T00:00:00.000Z",
    updatedBy: actorId,
    revision: 1,
    commitSequence: 1,
    archivedAt: null,
    archivedBy: null
  };
  const items = withProject
    ? [
        {
          project,
          owners: [
            {
              id: actorId,
              username: "owner",
              displayName: "项目负责人",
              accountStatus: "ACTIVE"
            }
          ]
        }
      ]
    : [];

  return new Response(
    JSON.stringify({ items, page: 1, pageSize: 20, total: items.length }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
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

async function selectAuthenticatedView(
  name: "账户" | "用户管理"
): Promise<void> {
  const navigation = await screen.findByRole("navigation", { name: "主导航" });
  fireEvent.click(within(navigation).getByRole("button", { name }));
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
    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument();
  });

  it("shows login when there is no authenticated session", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(authenticationFailure());

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument();
  });

  it("switches anonymous entry modes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(authenticationFailure());

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "登录" });
    fireEvent.click(screen.getByRole("button", { name: "使用激活码设置密码" }));
    expect(
      screen.getByRole("heading", { name: "激活账户" })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "使用重置码设置新密码" })
    );
    expect(
      screen.getByRole("heading", { name: "重设密码" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it.each([
    ["激活", "使用激活码设置密码", "激活账户", "/auth/activate"],
    [
      "重置",
      "使用重置码设置新密码",
      "重设密码",
      "/auth/password-reset/complete"
    ]
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

      render(
        <App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />
      );

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

      expect(
        await screen.findByRole("heading", { name: "登录" })
      ).toBeInTheDocument();
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

  it("opens projects by default and keeps account navigation and runtime information", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    let sessionRequestCount = 0;
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        sessionRequestCount += 1;
        return sessionRequestCount === 1
          ? authenticationFailure()
          : sessionResponse("LEADER");
      }
      if (url.endsWith("/auth/login")) {
        return noContentResponse();
      }
      if (url.endsWith("/v1/health")) {
        return healthResponse();
      }
      if (url.includes("/v1/projects?")) {
        return projectPageResponse();
      }
      return new Response(null, { status: 404 });
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await screen.findByRole("heading", { name: "登录" });
    fillLoginForm();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(
      await screen.findByRole("heading", { name: "项目" })
    ).toBeInTheDocument();
    expect(await screen.findByText("暂无项目")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(
      within(navigation).getByRole("button", { name: "项目" })
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole("button", { name: "账户" })
    ).toBeInTheDocument();
    await selectAuthenticatedView("账户");
    expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument();
    expect(screen.getByText("LEADER")).toBeInTheDocument();
    expect(await screen.findAllByText("已连接")).toHaveLength(2);
    expect(screen.getAllByText(SYSTEM_VERSION)).toHaveLength(2);
  });

  it("renders a project table through the real projects client", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/v1/health")) {
        return healthResponse();
      }
      if (url.includes("/v1/projects?")) {
        return projectPageResponse(true);
      }
      return new Response(null, { status: 404 });
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("App 接线项目")).toBeInTheDocument();
    expect(within(table).getByText("项目负责人")).toBeInTheDocument();
  });

  it("returns to session-expired login when project loading receives 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/v1/health")) {
        return healthResponse();
      }
      if (url.includes("/v1/projects?")) {
        return authenticationFailure();
      }
      return new Response(null, { status: 404 });
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText("会话已失效，请重新登录")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "项目" })
    ).not.toBeInTheDocument();
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

    await selectAuthenticatedView("账户");
    await screen.findByRole("heading", { name: "账户" });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(
      await screen.findByText("会话已失效，请重新登录")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("changes the current password from the account view", async () => {
    const currentPassword = makePassword();
    const newPassword = makePassword();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/auth/password/change")) {
        return noContentResponse();
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await selectAuthenticatedView("账户");
    await screen.findByRole("heading", { name: "账户" });
    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: currentPassword }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: newPassword }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: newPassword }
    });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(await screen.findByRole("status")).toHaveTextContent("密码已更新");
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/auth/password/change", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
  });

  it("expires the session when changing the password receives 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/auth/password/change")) {
        return authenticationFailure();
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await selectAuthenticatedView("账户");
    await screen.findByRole("heading", { name: "账户" });
    const newPassword = makePassword();
    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: makePassword() }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: newPassword }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: newPassword }
    });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(
      await screen.findByText("会话已失效，请重新登录")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("keeps the session when the current password is rejected", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("USER");
      }
      if (url.endsWith("/auth/password/change")) {
        return new Response(
          JSON.stringify({
            code: "INVALID_CREDENTIALS",
            message: "当前密码不正确"
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await selectAuthenticatedView("账户");
    await screen.findByRole("heading", { name: "账户" });
    const newPassword = makePassword();
    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: makePassword() }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: newPassword }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: newPassword }
    });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(
      await screen.findByText("修改密码失败，请稍后重试")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument();
    expect(
      screen.queryByText("会话已失效，请重新登录")
    ).not.toBeInTheDocument();
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

    await selectAuthenticatedView("账户");
    await screen.findByRole("heading", { name: "账户" });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument();
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

    await selectAuthenticatedView("用户管理");
    const adminUsersView = await screen.findByRole("region", {
      name: "用户管理"
    });
    expect(
      within(screen.getByRole("navigation", { name: "主导航" })).getByRole(
        "button",
        { name: "用户管理" }
      )
    ).toBeInTheDocument();
    expect(within(adminUsersView).getByRole("table")).toBeInTheDocument();
    expect(
      await within(adminUsersView).findByText(user.username)
    ).toBeInTheDocument();
  });

  it("expires the session when loading user management receives 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return sessionResponse("ADMIN");
      }
      if (url.endsWith("/v1/users")) {
        return authenticationFailure();
      }
      return healthResponse();
    });

    render(<App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />);

    await selectAuthenticatedView("用户管理");
    expect(
      await screen.findByText("会话已失效，请重新登录")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "用户管理" })
    ).not.toBeInTheDocument();
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

      render(
        <App apiBaseUrl="/api" environment="test" fetchImpl={fetchImpl} />
      );

      await screen.findByRole("heading", { name: "项目" });
      expect(
        screen.queryByRole("button", { name: "用户管理" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "用户管理" })
      ).not.toBeInTheDocument();
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
