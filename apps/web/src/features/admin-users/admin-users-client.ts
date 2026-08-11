import { ApiClientError, createApiClient } from "../../api-client.js";

export type UserRole = "USER" | "LEADER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type CredentialStatus = "PENDING_ACTIVATION" | "READY" | "RESET_REQUIRED";

export interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export interface IssuedCredential {
  user: ManagedUser;
  ticket: string;
  expiresAt: string;
}

export interface AdminUsersClient {
  listUsers(): Promise<ManagedUser[]>;
  createUser(input: Pick<ManagedUser, "username" | "displayName" | "role">): Promise<IssuedCredential>;
  reissueActivation(userId: string): Promise<IssuedCredential>;
  disableUser(userId: string): Promise<void>;
  enableUser(userId: string): Promise<void>;
  changeRole(userId: string, role: UserRole): Promise<void>;
  issuePasswordReset(userId: string): Promise<IssuedCredential>;
}

const JSON_HEADERS = {
  accept: "application/json",
  "content-type": "application/json"
};

function invalidResponse(status: number): ApiClientError {
  return new ApiClientError(status, "INVALID_RESPONSE", "API 响应无效");
}

function isManagedUser(value: unknown): value is ManagedUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "username" in value &&
    "displayName" in value &&
    "role" in value &&
    "accountStatus" in value &&
    "credentialStatus" in value &&
    "createdAt" in value &&
    "updatedAt" in value &&
    typeof value.id === "string" &&
    typeof value.username === "string" &&
    typeof value.displayName === "string" &&
    (value.role === "USER" || value.role === "LEADER" || value.role === "ADMIN") &&
    (value.accountStatus === "ACTIVE" || value.accountStatus === "DISABLED") &&
    (value.credentialStatus === "PENDING_ACTIVATION" ||
      value.credentialStatus === "READY" ||
      value.credentialStatus === "RESET_REQUIRED") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isIssuedCredential(value: unknown): value is IssuedCredential {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    "ticket" in value &&
    "expiresAt" in value &&
    isManagedUser(value.user) &&
    typeof value.ticket === "string" &&
    typeof value.expiresAt === "string"
  );
}

async function readJson<T>(response: Response, guard: (value: unknown) => value is T): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }

  if (!guard(payload)) {
    throw invalidResponse(response.status);
  }

  return payload;
}

export function createAdminUsersClient(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): AdminUsersClient {
  const apiClient = createApiClient(apiBaseUrl, fetchImpl);

  async function issue(path: string, method: "POST" | "PATCH", body: object = {}): Promise<IssuedCredential> {
    const response = await apiClient.request(path, {
      method,
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    });
    return readJson(response, isIssuedCredential);
  }

  async function command(path: string, method: "POST" | "PATCH", body: object = {}): Promise<void> {
    await apiClient.request(path, {
      method,
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    });
  }

  return {
    async listUsers() {
      const response = await apiClient.request("/v1/users", {
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      return readJson(response, (value): value is ManagedUser[] =>
        Array.isArray(value) && value.every(isManagedUser)
      );
    },
    createUser(input) {
      return issue("/v1/users", "POST", input);
    },
    reissueActivation(userId) {
      return issue(`/v1/users/${userId}/activation`, "POST");
    },
    disableUser(userId) {
      return command(`/v1/users/${userId}/disable`, "POST");
    },
    enableUser(userId) {
      return command(`/v1/users/${userId}/enable`, "POST");
    },
    changeRole(userId, role) {
      return command(`/v1/users/${userId}/role`, "PATCH", { role });
    },
    issuePasswordReset(userId) {
      return issue(`/v1/users/${userId}/password-reset`, "POST");
    }
  };
}
