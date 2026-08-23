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
        throw mapReadError(error, "本地项目保存失败，请重试");
      }
    }
  };
}
