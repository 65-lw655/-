export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface ApiErrorResponse {
  code: string;
  message: string;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  try {
    const payload: unknown = await response.json();
    if (isApiErrorResponse(payload)) {
      return new ApiClientError(response.status, payload.code, payload.message);
    }
  } catch {
    // Fall through to the generic public error.
  }

  return new ApiClientError(response.status, "REQUEST_FAILED", "请求失败");
}

export interface ApiClient {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export function createApiClient(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): ApiClient {
  return {
    async request(path, init = {}) {
      let response: Response;
      try {
        response = await fetchImpl(`${apiBaseUrl}${path}`, {
          ...init,
          credentials: "same-origin"
        });
      } catch {
        throw new ApiClientError(0, "NETWORK_ERROR", "无法连接 API");
      }

      if (!response.ok) {
        throw await toApiClientError(response);
      }

      return response;
    }
  };
}
