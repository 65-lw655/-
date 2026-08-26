import {
  validateProjectInput,
  type ProjectInput
} from "@project-online/domain";
import { ProjectRepositoryError } from "@project-online/ui";

import { ApiClientError } from "../../api-client.js";

export function toProjectUpdateRepositoryError(
  error: unknown,
  input: ProjectInput
): unknown {
  if (!(error instanceof ApiClientError)) {
    return new ProjectRepositoryError(
      "UNAVAILABLE",
      error instanceof Error && error.message
        ? error.message
        : "项目保存失败，请重试",
      { cause: error }
    );
  }

  if (
    error.status === 401 &&
    (error.code === "SESSION_EXPIRED" ||
      error.code === "AUTHENTICATION_REQUIRED")
  ) {
    return new ProjectRepositoryError("AUTHENTICATION_REQUIRED", "请重新登录", {
      cause: error
    });
  }

  if (error.status === 403) {
    return new ProjectRepositoryError(
      "PROJECT_FORBIDDEN",
      "您没有编辑项目的权限",
      {
        cause: error
      }
    );
  }

  if (error.status === 400 && error.code === "VALIDATION_ERROR") {
    const validation = validateProjectInput(input);
    return new ProjectRepositoryError("VALIDATION_FAILED", error.message, {
      cause: error,
      fieldErrors: validation.ok ? undefined : validation.fields
    });
  }

  return new ProjectRepositoryError("UNAVAILABLE", error.message, {
    cause: error
  });
}
