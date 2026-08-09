import { SYSTEM_VERSION } from "@project-online/domain";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Layers3,
  Settings2
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { resolveWebConfig } from "./config.js";
import { checkApiHealth } from "./health-client.js";

type ApiStatus =
  | { kind: "checking"; title: "正在检查"; message: "正在连接 API" }
  | { kind: "connected"; title: "已连接"; service: string; version: string }
  | {
      kind: "error";
      title: "配置缺失" | "连接失败" | "版本不一致";
      message: string;
    };

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

export function App({
  apiBaseUrl = import.meta.env.VITE_API_BASE_URL,
  environment = import.meta.env.MODE,
  fetchImpl = fetch
}: AppProps) {
  const [apiCheck, setApiCheck] = useState<ApiCheck>({
    apiBaseUrl: "",
    status: CHECKING_STATUS
  });

  useEffect(() => {
    const config = resolveWebConfig(apiBaseUrl);
    if (!config.ok) {
      return;
    }

    let active = true;

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
  }, [apiBaseUrl, fetchImpl]);

  const config = resolveWebConfig(apiBaseUrl);
  const status: ApiStatus = !config.ok
    ? { kind: "error", title: "配置缺失", message: config.message }
    : apiCheck.apiBaseUrl === config.apiBaseUrl
      ? apiCheck.status
      : CHECKING_STATUS;

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

          <dl className="runtime-meta" aria-label="运行信息">
            <div>
              <dt>环境</dt>
              <dd>{environment}</dd>
            </div>
            <div>
              <dt>系统版本</dt>
              <dd>{SYSTEM_VERSION}</dd>
            </div>
          </dl>
        </div>
      </header>

      <main className="main-content">
        <section className="status-section" aria-labelledby="service-status">
          <div className="section-heading">
            <h2 id="service-status">服务状态</h2>
          </div>

          <div className="status-panel" data-status={status.kind}>
            <div className="status-panel__summary">
              <span className="status-panel__icon">
                <StatusIcon status={status} />
              </span>
              <div>
                <p className="status-panel__label">API 服务</p>
                <h3>{status.title}</h3>
                {status.kind === "checking" || status.kind === "error" ? (
                  <p className="status-panel__message">{status.message}</p>
                ) : (
                  <p className="status-panel__message">服务响应正常</p>
                )}
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
        </section>
      </main>
    </div>
  );
}
