import { ProjectRepositoryError, type ProjectRepository } from "@project-online/ui";

import type { DesktopBridge } from "../platform/desktop-bridge.js";

interface DesktopCommandError {
  code?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
}

function isCommandError(error: unknown): error is DesktopCommandError {
  return typeof error === "object" && error !== null && "code" in error;
}

function unavailableMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mapReadError(error: unknown, fallback: string): ProjectRepositoryError {
  if (isCommandError(error) && error.code === "PROJECT_NOT_FOUND") {
    return new ProjectRepositoryError(
      "PROJECT_NOT_FOUND",
      "项目不存在或您无权查看",
      { cause: error }
    );
  }

  return new ProjectRepositoryError("UNAVAILABLE", unavailableMessage(error, fallback), {
    cause: error
  });
}

function fieldErrorsFrom(error: DesktopCommandError):
  | Readonly<Record<string, string>>
  | undefined {
  if (
    typeof error.fieldErrors !== "object" ||
    error.fieldErrors === null ||
    Array.isArray(error.fieldErrors)
  ) {
    return undefined;
  }

  const fields = Object.entries(error.fieldErrors).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );

  return fields.length > 0 ? Object.fromEntries(fields) : undefined;
}

function mapUpdateError(error: unknown): ProjectRepositoryError {
  if (isCommandError(error)) {
    if (error.code === "PROJECT_FORBIDDEN") {
      return new ProjectRepositoryError(
        "PROJECT_FORBIDDEN",
        "您没有编辑项目的权限",
        { cause: error }
      );
    }
    if (error.code === "PROJECT_NOT_FOUND") {
      return new ProjectRepositoryError(
        "PROJECT_NOT_FOUND",
        "项目不存在或您无权查看",
        { cause: error }
      );
    }
    if (error.code === "VALIDATION_FAILED") {
      return new ProjectRepositoryError(
        "VALIDATION_FAILED",
        typeof error.message === "string" ? error.message : "字段校验失败",
        { cause: error, fieldErrors: fieldErrorsFrom(error) }
      );
    }
    if (error.code === "LOCAL_WRITE_FAILED") {
      return new ProjectRepositoryError(
        "UNAVAILABLE",
        "本地项目保存失败，请重试",
        { cause: error }
      );
    }
  }

  return new ProjectRepositoryError(
    "UNAVAILABLE",
    unavailableMessage(error, "本地项目保存失败，请重试"),
    { cause: error }
  );
}

export function createLocalProjectRepository(
  bridge: Pick<DesktopBridge, "listProjects" | "getProject" | "updateProject">
): ProjectRepository {
  return {
    listProjects: async (filters) => {
      try {
        return await bridge.listProjects(filters);
      } catch (error) {
        throw mapReadError(error, "本地项目加载失败，请重试");
      }
    },
    getProject: async (projectId) => {
      try {
        return await bridge.getProject(projectId);
      } catch (error) {
        throw mapReadError(error, "本地项目详情加载失败，请重试");
      }
    },
    updateProject: async (projectId, input) => {
      try {
        return await bridge.updateProject(projectId, input);
      } catch (error) {
        throw mapUpdateError(error);
      }
    }
  };
}
