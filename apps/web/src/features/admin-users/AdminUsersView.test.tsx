// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminUsersView } from "./AdminUsersView.js";

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "USER" | "LEADER" | "ADMIN";
  accountStatus: "ACTIVE" | "DISABLED";
  credentialStatus: "PENDING_ACTIVATION" | "READY" | "RESET_REQUIRED";
  createdAt: string;
  updatedAt: string;
};

const API_BASE_URL = "/api";

afterEach(() => {
  cleanup();
});

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: crypto.randomUUID(),
    username: `user-${crypto.randomUUID()}`,
    displayName: "测试用户",
    role: "USER",
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    createdAt: "2026-08-11T08:00:00.000Z",
    updatedAt: "2026-08-11T08:00:00.000Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function apiError(code: string, message: string, status: number): Response {
  return jsonResponse({ code, message }, status);
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function renderView(fetchImpl: typeof fetch) {
  return render(<AdminUsersView apiBaseUrl={API_BASE_URL} fetchImpl={fetchImpl} />);
}

function openActions(user: User): HTMLElement {
  const row = screen.getByRole("row", { name: new RegExp(user.username) });
  fireEvent.click(within(row).getByRole("button", { name: "操作" }));
  return row;
}

describe("AdminUsersView", () => {
  it("loads the fixed-column user table", async () => {
    const user = createUser();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([user]));

    renderView(fetchImpl);

    expect(await screen.findByText(user.displayName)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "显示名称" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "登录名" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "角色" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "账号状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "凭证状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "更新时间" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
  });

  it("creates a passwordless account and clears its activation code when closed", async () => {
    const activationCode = crypto.randomUUID();
    const issuedUser = createUser({ credentialStatus: "PENDING_ACTIVATION" });
    const refreshedUser = {
      ...issuedUser,
      displayName: "已开通用户"
    };
    let listRequestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/users") && init?.method === "POST") {
        return jsonResponse({
          user: issuedUser,
          ticket: activationCode,
          expiresAt: "2026-08-12T08:00:00.000Z"
        }, 201);
      }
      listRequestCount += 1;
      return jsonResponse(listRequestCount === 1 ? [] : [refreshedUser]);
    });

    renderView(fetchImpl);
    await screen.findByRole("button", { name: "开通账号" });
    fireEvent.click(screen.getByRole("button", { name: "开通账号" }));

    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(screen.getByLabelText("显示名称")).toBeInTheDocument();
    expect(screen.getByLabelText("角色")).toBeInTheDocument();
    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: issuedUser.username }
    });
    fireEvent.change(screen.getByLabelText("显示名称"), {
      target: { value: issuedUser.displayName }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认开通" }));

    expect(await screen.findByText("激活码仅显示一次")).toBeInTheDocument();
    expect(screen.getByText(activationCode)).toBeInTheDocument();
    await waitFor(() => {
      const listRequests = fetchImpl.mock.calls.filter(([input, init]) =>
        String(input) === `${API_BASE_URL}/v1/users` && init?.method === undefined
      );
      expect(listRequests).toHaveLength(2);
      expect(screen.getByText(refreshedUser.displayName)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(activationCode)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开通账号" }));
    expect(screen.queryByText(activationCode)).not.toBeInTheDocument();
  });

  it("reissues an activation code for a pending account", async () => {
    const pendingUser = createUser({ credentialStatus: "PENDING_ACTIVATION" });
    const activationCode = crypto.randomUUID();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/${pendingUser.id}/activation`)) {
        return jsonResponse({
          user: pendingUser,
          ticket: activationCode,
          expiresAt: "2026-08-12T08:00:00.000Z"
        });
      }
      return jsonResponse([pendingUser]);
    });

    renderView(fetchImpl);
    await screen.findByText(pendingUser.displayName);
    openActions(pendingUser);
    fireEvent.click(screen.getByRole("menuitem", { name: "重新签发激活码" }));

    expect(await screen.findByText("激活码仅显示一次")).toBeInTheDocument();
    expect(screen.getByText(activationCode)).toBeInTheDocument();
  });

  it("requires confirmation before disabling and enabling accounts", async () => {
    const activeUser = createUser();
    const disabledUser = createUser({ accountStatus: "DISABLED" });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/${activeUser.id}/disable`) || url.endsWith(`/${disabledUser.id}/enable`)) {
        return noContent();
      }
      return jsonResponse([activeUser, disabledUser]);
    });

    renderView(fetchImpl);
    await screen.findByText(activeUser.username);

    openActions(activeUser);
    fireEvent.click(screen.getByRole("menuitem", { name: "停用" }));
    expect(screen.getByRole("dialog", { name: "确认停用账号" })).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/v1/users/${activeUser.id}/disable`,
      expect.anything()
    );
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        `${API_BASE_URL}/v1/users/${activeUser.id}/disable`,
        expect.objectContaining({ method: "POST" })
      );
    });

    openActions(disabledUser);
    fireEvent.click(screen.getByRole("menuitem", { name: "启用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认启用" }));
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        `${API_BASE_URL}/v1/users/${disabledUser.id}/enable`,
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("uses the role menu and confirms a role change", async () => {
    const user = createUser();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/${user.id}/role`) && init?.method === "PATCH") {
        return jsonResponse({ ...user, role: "LEADER" });
      }
      return jsonResponse([user]);
    });

    renderView(fetchImpl);
    await screen.findByText(user.displayName);
    openActions(user);
    fireEvent.click(screen.getByRole("menuitem", { name: "调整角色" }));
    fireEvent.change(screen.getByLabelText("新角色"), { target: { value: "LEADER" } });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("dialog", { name: "确认调整角色" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认调整" }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        `${API_BASE_URL}/v1/users/${user.id}/role`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ role: "LEADER" })
        })
      );
    });
  });

  it("confirms password reset and displays its code once", async () => {
    const user = createUser();
    const resetCode = crypto.randomUUID();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/${user.id}/password-reset`)) {
        return jsonResponse({
          user: { ...user, credentialStatus: "RESET_REQUIRED" },
          ticket: resetCode,
          expiresAt: "2026-08-11T08:30:00.000Z"
        });
      }
      return jsonResponse([user]);
    });

    renderView(fetchImpl);
    await screen.findByText(user.displayName);
    openActions(user);
    fireEvent.click(screen.getByRole("menuitem", { name: "重置密码" }));
    expect(screen.getByRole("dialog", { name: "确认重置密码" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    expect(await screen.findByText("重置码仅显示一次")).toBeInTheDocument();
    expect(screen.getByText(resetCode)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(resetCode)).not.toBeInTheDocument();
  });

  it("shows a no-permission message for a 403 response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apiError("FORBIDDEN", "Operation is not allowed", 403));

    renderView(fetchImpl);

    expect(await screen.findByRole("alert")).toHaveTextContent("您没有管理用户的权限");
  });

  it("explains that the last active administrator must remain available", async () => {
    const administrator = createUser({ role: "ADMIN" });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/${administrator.id}/disable`)) {
        return apiError(
          "LAST_ADMIN_REQUIRED",
          "At least one active administrator is required",
          409
        );
      }
      return jsonResponse([administrator]);
    });

    renderView(fetchImpl);
    await screen.findByText(administrator.displayName);
    openActions(administrator);
    fireEvent.click(screen.getByRole("menuitem", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "至少保留一名启用且已激活的管理员"
    );
  });
});
