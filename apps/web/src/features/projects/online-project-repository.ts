import { ProjectRepositoryError, type ProjectRepository } from "@project-online/ui";

import { ApiClientError } from "../../api-client.js";
import { toProjectUpdateRepositoryError } from "./project-repository-error.js";
import type { ProjectsClient } from "./projects-client.js";

function unavailableMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mapReadError(
  error: unknown,
  options: {
    forbiddenMessage: string;
    notFoundMessage?: string;
    unavailableMessage: string;
  }
): ProjectRepositoryError | unknown {
  if (!(error instanceof ApiClientError)) {
    return new ProjectRepositoryError(
      "UNAVAILABLE",
      unavailableMessage(error, options.unavailableMessage),
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
      options.forbiddenMessage,
      { cause: error }
    );
  }

  if (error.status === 404) {
    return new ProjectRepositoryError(
      "PROJECT_NOT_FOUND",
      options.notFoundMessage ?? "项目不存在或您无权查看",
      { cause: error }
    );
  }

  return new ProjectRepositoryError(
    "UNAVAILABLE",
    unavailableMessage(error, options.unavailableMessage),
    { cause: error }
  );
}

export function createOnlineProjectRepository(
  client: Pick<ProjectsClient, "listProjects" | "getProject" | "updateProject">
): ProjectRepository {
  return {
    listProjects: async (filters) => {
      try {
        const page = await client.listProjects(filters);
        return {
          ...page,
          items: page.items.map(({ owners, ...item }) => ({
            ...item,
            ownerLabels: owners.map(({ displayName }) => displayName)
          }))
        };
      } catch (error) {
        throw mapReadError(error, {
          forbiddenMessage: "您没有查看项目的权限",
          unavailableMessage: "项目加载失败，请重试"
        });
      }
    },
    getProject: async (projectId) => {
      try {
        return await client.getProject(projectId);
      } catch (error) {
        throw mapReadError(error, {
          forbiddenMessage: "您没有查看此项目的权限",
          notFoundMessage: "项目不存在或您无权查看",
          unavailableMessage: "项目详情加载失败，请重试"
        });
      }
    },
    updateProject: async (projectId, input) => {
      try {
        return await client.updateProject(projectId, input);
      } catch (error) {
        throw toProjectUpdateRepositoryError(error, input);
      }
    }
  };
}
