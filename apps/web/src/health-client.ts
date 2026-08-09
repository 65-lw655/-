import { SYSTEM_VERSION } from "@project-online/domain";

export type HealthResult =
  | { ok: true; service: string; systemVersion: string }
  | {
      ok: false;
      reason: "network" | "response" | "version";
      message: string;
    };

interface ApiHealthResponse {
  status: "ok";
  service: string;
  environment: string;
  systemVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiHealthResponse(value: unknown): value is ApiHealthResponse {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.service === "string" &&
    typeof value.environment === "string" &&
    typeof value.systemVersion === "string"
  );
}

export async function checkApiHealth(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<HealthResult> {
  let response: Response;

  try {
    response = await fetchImpl(`${apiBaseUrl}/v1/health`, {
      headers: { accept: "application/json" }
    });
  } catch {
    return { ok: false, reason: "network", message: "无法连接 API" };
  }

  if (!response.ok) {
    return { ok: false, reason: "response", message: "API 响应无效" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "response", message: "API 响应无效" };
  }

  if (!isApiHealthResponse(payload)) {
    return { ok: false, reason: "response", message: "API 响应无效" };
  }

  if (payload.systemVersion !== SYSTEM_VERSION) {
    return { ok: false, reason: "version", message: "API 版本不一致" };
  }

  return {
    ok: true,
    service: payload.service,
    systemVersion: payload.systemVersion
  };
}
