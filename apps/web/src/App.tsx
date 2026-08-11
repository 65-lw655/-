import { SYSTEM_VERSION } from "@project-online/domain";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Layers3,
  Settings2
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiClientError } from "./api-client.js";
import { resolveWebConfig } from "./config.js";
import { AccountView } from "./features/auth/AccountView.js";
import { createAuthClient, type SessionUser } from "./features/auth/auth-client.js";
import { LoginView } from "./features/auth/LoginView.js";
import { SetPasswordView } from "./features/auth/SetPasswordView.js";
import { checkApiHealth } from "./health-client.js";

type ApiStatus =
  | { kind: "checking"; title: "正在检查"; message: "正在连接 API" }
  | { kind: "connected"; title: "已连接"; service: string; version: string }
  | {
      kind: "error";
      title: "配置缺失" | "连接失败" | "版本不一致";
      message: string;
    };

type SessionState =
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: SessionUser }
  | { kind: "sessionExpired" };

type AuthEntryMode = "login" | "activate" | "reset";

interface ApiCheck {
  apiBaseUrl: string;
  status: ApiStatus;
}

const CHECKING_STATUS: ApiStatus = {
  kind: "checking",
  title: "正在检查",
  message: "正在连接 API"
};

export interface AppProps {
  apiBaseUrl?: string;
  environment?: string;
  fetchImpl?: typeof fetch;
}

function StatusIcon({ status }: { status: ApiStatus }): ReactNode {
  if (status.kind === "connected") {
    return <CheckCircle2 aria-hidden="true" />;
  }

  if (status.kind === "checking") {
    return <CircleDashed aria-hidden="true" />;
  }

  return status.title === "配置缺失" ? (
    <Settings2 aria-hidden="true" />
  ) : (
    <AlertCircle aria-hidden="true" />
  );
}

function ApiStatusPanel({ status }: { status: ApiStatus }) {
  return (
    <div className="status-panel" data-status={status.kind}>
      <div className="status-panel__summary">
        <span className="status-panel__icon">
          <StatusIcon status={status} />
        </span>
        <div>
          <p className="status-panel__label">API 服务</p>
          <h3>{status.title}</h3>
          <p className="status-panel__message">
            {status.kind === "connected" ? "服务响应正常" : status.message}
          </p>
        </div>
      </div>
      {status.kind === "connected" ? (
        <dl className="status-details">
          <div>
            <dt>服务标识</dt>
            <dd>{status.service}</dd>
          </div>
          <div>
            <dt>API 版本</dt>
            <dd>{status.version}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

export function App({
  apiBaseUrl = import.meta.env.VITE_API_BASE_URL,
  environment = import.meta.env.MODE,
  fetchImpl = fetch
}: AppProps) {
  const config = useMemo(() => resolveWebConfig(apiBaseUrl), [apiBaseUrl]);
  const authClient = useMemo(
    () => (config.ok ? createAuthClient(config.apiBaseUrl, fetchImpl) : null),
    [config, fetchImpl]
  );
  const [session, setSession] = useState<SessionState>({ kind: "checking" });
  const [authEntryMode, setAuthEntryMode] = useState<AuthEntryMode>("login");
  const [apiCheck, setApiCheck] = useState<ApiCheck>({
    apiBaseUrl: "",
    status: CHECKING_STATUS
  });

  useEffect(() => {
    if (!authClient) {
      setSession({ kind: "anonymous" });
      return;
    }

    let active = true;

    void authClient
      .getSession()
      .then((user) => {
        if (active) {
          setSession(user ? { kind: "authenticated", user } : { kind: "anonymous" });
        }
      })
      .catch(() => {
        if (active) {
          setSession({ kind: "anonymous" });
        }
      });

    return () => {
      active = false;
    };
  }, [authClient]);

  useEffect(() => {
    if (!config.ok || session.kind !== "authenticated") {
      return;
    }

    let active = true;
    setApiCheck({ apiBaseUrl: config.apiBaseUrl, status: CHECKING_STATUS });

    void checkApiHealth(config.apiBaseUrl, fetchImpl).then((result) => {
      if (!active) {
        return;
      }

      if (result.ok) {
        setApiCheck({
          apiBaseUrl: config.apiBaseUrl,
          status: {
            kind: "connected",
            title: "已连接",
            service: result.service,
            version: result.systemVersion
          }
        });
        return;
      }

      setApiCheck({
        apiBaseUrl: config.apiBaseUrl,
        status: {
          kind: "error",
          title: result.reason === "version" ? "版本不一致" : "连接失败",
          message: result.message
        }
      });
    });

    return () => {
      active = false;
    };
  }, [config, fetchImpl, session.kind]);

  async function handleLogin(username: string, password: string): Promise<void> {
    if (!authClient) {
      throw new Error("Authentication API is unavailable");
    }

    await authClient.login(username, password);
    const user = await authClient.getSession();
    setSession(user ? { kind: "authenticated", user } : { kind: "anonymous" });
  }

  async function handleLogout(): Promise<void> {
    if (!authClient) {
      setSession({ kind: "anonymous" });
      return;
    }

    try {
      await authClient.logout();
      setSession({ kind: "anonymous" });
    } catch (error) {
      setSession(
        error instanceof ApiClientError && error.status === 401
          ? { kind: "sessionExpired" }
          : { kind: "anonymous" }
      );
    }
  }

  async function handleActivation(ticket: string, password: string): Promise<void> {
    if (!authClient) {
      throw new Error("Authentication API is unavailable");
    }

    await authClient.activate(ticket, password);
  }

  async function handleReset(ticket: string, password: string): Promise<void> {
    if (!authClient) {
      throw new Error("Authentication API is unavailable");
    }

    await authClient.completeReset(ticket, password);
  }

  const status: ApiStatus = config.ok
    ? apiCheck.apiBaseUrl === config.apiBaseUrl
      ? apiCheck.status
      : CHECKING_STATUS
    : { kind: "error", title: "配置缺失", message: config.message };

  const authenticated = session.kind === "authenticated";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <Layers3 />
            </span>
            <h1>项目管理线上版</h1>
          </div>
          {authenticated ? (
            <dl className="runtime-meta" aria-label="运行信息">
              <div>
                <dt>环境</dt>
                <dd>{environment}</dd>
              </div>
              <div>
                <dt>系统版本</dt>
                <dd>{SYSTEM_VERSION}</dd>
              </div>
              <div>
                <dt>API</dt>
                <dd>{status.title}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </header>

      <main className="main-content">
        {session.kind === "checking" ? (
          <p className="session-message" role="status">正在恢复会话</p>
        ) : null}
        {session.kind === "anonymous" || session.kind === "sessionExpired" ? (
          <div className="auth-layout">
            {session.kind === "sessionExpired" ? (
              <p className="form-error" role="alert">会话已失效，请重新登录</p>
            ) : null}
            {!config.ok ? <p className="form-error" role="alert">{config.message}</p> : null}
            <div className="auth-entry-actions">
              {authEntryMode !== "login" ? (
                <button
                  className="secondary-button"
                  onClick={() => setAuthEntryMode("login")}
                  type="button"
                >
                  返回登录
                </button>
              ) : null}
              {authEntryMode !== "activate" ? (
                <button
                  className="secondary-button"
                  onClick={() => setAuthEntryMode("activate")}
                  type="button"
                >
                  使用激活码设置密码
                </button>
              ) : null}
              {authEntryMode !== "reset" ? (
                <button
                  className="secondary-button"
                  onClick={() => setAuthEntryMode("reset")}
                  type="button"
                >
                  使用重置码设置新密码
                </button>
              ) : null}
            </div>
            {authEntryMode === "login" ? (
              <LoginView onLogin={handleLogin} onSuccess={() => undefined} />
            ) : (
              <SetPasswordView
                key={authEntryMode}
                mode={authEntryMode}
                onSubmit={
                  authEntryMode === "activate" ? handleActivation : handleReset
                }
                onSuccess={() => setAuthEntryMode("login")}
              />
            )}
          </div>
        ) : null}
        {authenticated ? (
          <section className="authenticated-content">
            <AccountView user={session.user} onLogout={() => void handleLogout()} />
            <ApiStatusPanel status={status} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
