import { ApiClientError, createApiClient } from "../../api-client.js";

export interface SessionUser {
  userId: string;
  role: "USER" | "LEADER" | "ADMIN";
}

export interface AuthClient {
  getSession(): Promise<SessionUser | null>;
  login(username: string, password: string): Promise<void>;
  activate(ticket: string, password: string): Promise<void>;
  completeReset(ticket: string, password: string): Promise<void>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const JSON_HEADERS = {
  accept: "application/json",
  "content-type": "application/json"
};

function isSessionUser(value: unknown): value is SessionUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    "role" in value &&
    typeof value.userId === "string" &&
    (value.role === "USER" || value.role === "LEADER" || value.role === "ADMIN")
  );
}

export function createAuthClient(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): AuthClient {
  const apiClient = createApiClient(apiBaseUrl, fetchImpl);

  async function post(
    path: string,
    body: Record<string, string> = {}
  ): Promise<void> {
    await apiClient.request(path, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    });
  }

  return {
    async getSession() {
      try {
        const response = await apiClient.request("/v1/auth/session", {
          cache: "no-store",
          headers: { accept: "application/json" }
        });
        const payload: unknown = await response.json();
        if (!isSessionUser(payload)) {
          throw new ApiClientError(
            response.status,
            "INVALID_RESPONSE",
            "API 响应无效"
          );
        }
        return payload;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    login(username, password) {
      return post("/v1/auth/login", { username, password, deviceName: "web" });
    },
    activate(ticket, password) {
      return post("/v1/auth/activate", { ticket, password });
    },
    completeReset(ticket, password) {
      return post("/v1/auth/password-reset/complete", { ticket, password });
    },
    refresh() {
      return post("/v1/auth/refresh");
    },
    logout() {
      return post("/v1/auth/logout");
    },
    changePassword(currentPassword, newPassword) {
      return post("/v1/auth/password/change", { currentPassword, newPassword });
    }
  };
}
