// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../api-client.js";
import { createAuthClient } from "./auth-client.js";
import { LoginView } from "./LoginView.js";
import { SetPasswordView } from "./SetPasswordView.js";

afterEach(() => {
  cleanup();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function makePassword(): string {
  return `P${crypto.randomUUID()}!`;
}

function makeOpaqueValue(): string {
  return crypto.randomUUID();
}

describe("createAuthClient", () => {
  it("uses same-origin credentials for session recovery and returns the session user", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ userId: crypto.randomUUID(), role: "LEADER" })
      );
    const client = createAuthClient("/api", fetchImpl);

    await expect(client.getSession()).resolves.toMatchObject({
      role: "LEADER"
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
  });

  it("returns null when session recovery receives an authentication failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ code: "SESSION_EXPIRED", message: "会话已失效" }, 401)
      );
    const client = createAuthClient("/api", fetchImpl);

    await expect(client.getSession()).resolves.toBeNull();
  });

  it("sends login details as JSON and accepts the empty success response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(noContentResponse());
    const client = createAuthClient("/api", fetchImpl);
    const password = makePassword();

    await expect(client.login("member", password)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ username: "member", password, deviceName: "web" })
    });
  });

  it("sends activation and reset tickets without retaining them", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(noContentResponse());
    const client = createAuthClient("/api", fetchImpl);
    const activationTicket = makeOpaqueValue();
    const resetTicket = makeOpaqueValue();
    const activationPassword = makePassword();
    const resetPassword = makePassword();

    await client.activate(activationTicket, activationPassword);
    await client.completeReset(resetTicket, resetPassword);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/v1/auth/activate", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ticket: activationTicket,
        password: activationPassword
      })
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/password-reset/complete",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ ticket: resetTicket, password: resetPassword })
      }
    );
  });

  it("posts empty JSON bodies for refresh and logout", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(noContentResponse());
    const client = createAuthClient("/api", fetchImpl);

    await client.refresh();
    await client.logout();

    for (const [path, options] of [
      ["/api/v1/auth/refresh", expect.any(Object)],
      ["/api/v1/auth/logout", expect.any(Object)]
    ]) {
      expect(fetchImpl).toHaveBeenCalledWith(path, options);
    }
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: "{}"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: "{}"
    });
  });

  it("posts both password values to change the current password", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(noContentResponse());
    const client = createAuthClient("/api", fetchImpl);
    const currentPassword = makePassword();
    const newPassword = makePassword();

    await client.changePassword(currentPassword, newPassword);

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

  it("parses the API error body consistently", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ code: "INVALID_CREDENTIALS", message: "登录失败" }, 400)
      );
    const client = createAuthClient("/api", fetchImpl);

    await expect(client.login("member", makePassword())).rejects.toEqual(
      new ApiClientError(400, "INVALID_CREDENTIALS", "登录失败")
    );
  });
});

describe("LoginView", () => {
  it("renders the login fields and disables them while submitting", async () => {
    let completeLogin: (() => void) | undefined;
    const onLogin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeLogin = resolve;
        })
    );

    render(<LoginView onLogin={onLogin} onSuccess={vi.fn()} />);

    const username = screen.getByLabelText("用户名");
    const password = screen.getByLabelText("密码");
    fireEvent.change(username, { target: { value: "member" } });
    fireEvent.change(password, { target: { value: makePassword() } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(username).toBeDisabled();
    expect(password).toBeDisabled();
    expect(screen.getByRole("button", { name: "登录中" })).toBeDisabled();

    completeLogin?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "登录" })).toBeEnabled()
    );
  });

  it("shows a generic failure when login is rejected", async () => {
    render(
      <LoginView
        onLogin={() => Promise.reject(new Error("request failed"))}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "member" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: makePassword() }
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("登录失败，请稍后重试")).toBeInTheDocument();
  });

  it("notifies the parent after a successful login", async () => {
    const onSuccess = vi.fn();

    render(
      <LoginView onLogin={() => Promise.resolve()} onSuccess={onSuccess} />
    );

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "member" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: makePassword() }
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });
});

describe("SetPasswordView", () => {
  it("uses distinct activation and reset headings", () => {
    const { rerender } = render(
      <SetPasswordView
        mode="activate"
        onSubmit={() => Promise.resolve()}
        onSuccess={vi.fn()}
      />
    );

    expect(
      screen.getByRole("heading", { name: "激活账户" })
    ).toBeInTheDocument();

    rerender(
      <SetPasswordView
        mode="reset"
        onSubmit={() => Promise.resolve()}
        onSuccess={vi.fn()}
      />
    );

    expect(
      screen.getByRole("heading", { name: "重设密码" })
    ).toBeInTheDocument();
  });

  it("rejects a password shorter than twelve characters", () => {
    render(
      <SetPasswordView mode="activate" onSubmit={vi.fn()} onSuccess={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("一次性码"), {
      target: { value: makeOpaqueValue() }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: crypto.randomUUID().slice(0, 11) }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: crypto.randomUUID().slice(0, 11) }
    });
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));

    expect(screen.getByText("密码至少需要 12 个字符")).toBeInTheDocument();
  });

  it("rejects different password entries", () => {
    render(
      <SetPasswordView mode="reset" onSubmit={vi.fn()} onSuccess={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("一次性码"), {
      target: { value: makeOpaqueValue() }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: makePassword() }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: makePassword() }
    });
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));

    expect(screen.getByText("两次输入的密码不一致")).toBeInTheDocument();
  });

  it("clears the one-time code and passwords after a successful submission", async () => {
    const newPassword = makePassword();
    const ticket = makeOpaqueValue();
    const onSuccess = vi.fn();
    const onSubmit = vi.fn(() => Promise.resolve());

    render(
      <SetPasswordView
        mode="activate"
        onSubmit={onSubmit}
        onSuccess={onSuccess}
      />
    );

    fireEvent.change(screen.getByLabelText("一次性码"), {
      target: { value: ticket }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: newPassword }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: newPassword }
    });
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("一次性码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
  });
});
