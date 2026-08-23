import { invoke } from "@tauri-apps/api/core";
import type { ProjectInput, ProjectListFilters } from "@project-online/domain";
import type { ProjectDetails, ProjectPage } from "@project-online/ui";

export interface LocalStatus {
  deviceId: string;
  pendingCount: number;
}

export interface DesktopBridge {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(
    projectId: string,
    input: ProjectInput
  ): Promise<ProjectDetails>;
  getLocalStatus(): Promise<LocalStatus>;
}

export type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export function createDesktopBridge(invokeCommand: Invoke = invoke): DesktopBridge {
  return {
    listProjects: (filters) =>
      invokeCommand<ProjectPage>("list_local_projects", { filters }),
    getProject: (projectId) =>
      invokeCommand<ProjectDetails>("get_local_project", { projectId }),
    updateProject: (projectId, input) =>
      invokeCommand<ProjectDetails>("update_local_project", {
        projectId,
        input
      }),
    getLocalStatus: () => invokeCommand<LocalStatus>("get_local_status")
  };
}

export const desktopBridge = createDesktopBridge();
