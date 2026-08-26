import { invoke } from "@tauri-apps/api/core";
import type { ProjectInput, ProjectListFilters } from "@project-online/domain";
import type { ProjectDetails, ProjectPage } from "@project-online/ui";

export interface LocalStatus {
  deviceId: string;
  pendingCount: number;
}

export interface PendingOutboxItem {
  operationId: string;
  protocolVersion: number;
  deviceId: string;
  clientSequence: number;
  entityType: "PROJECT";
  entityId: string;
  projectId: string;
  action: "UPSERT" | "DELETE";
  baseRevision: number;
  payloadJson: string;
  attempts: number;
  lastError: string | null;
}

export type CredentialStatus = "PRESENT" | "MISSING" | "UNAVAILABLE";

export interface DesktopBridge {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(
    projectId: string,
    input: ProjectInput
  ): Promise<ProjectDetails>;
  getLocalStatus(): Promise<LocalStatus>;
  pendingOutbox?(limit: number): Promise<PendingOutboxItem[]>;
  acknowledgeOutbox?(operationId: string): Promise<void>;
  recordOutboxFailure?(operationId: string, message: string): Promise<void>;
  getSyncCursor?(): Promise<number>;
  advanceSyncCursor?(cursor: number): Promise<void>;
  applyProjectChange?(input: {
    projectId: string;
    revision: number;
    commitSequence: number;
    deleted: boolean;
    project: Record<string, unknown> | null;
  }): Promise<void>;
  credentialStatus(): Promise<CredentialStatus>;
  saveCredential(credential: string): Promise<CredentialStatus>;
  deleteCredential(): Promise<CredentialStatus>;
}

export type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export function createDesktopBridge(
  invokeCommand: Invoke = invoke
): DesktopBridge {
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
    getLocalStatus: () => invokeCommand<LocalStatus>("get_local_status"),
    pendingOutbox: (limit) =>
      invokeCommand<PendingOutboxItem[]>("list_pending_outbox", { limit }),
    acknowledgeOutbox: (operationId) =>
      invokeCommand<void>("acknowledge_outbox", { operationId }),
    recordOutboxFailure: (operationId, message) =>
      invokeCommand<void>("record_outbox_failure", { operationId, message }),
    getSyncCursor: () => invokeCommand<number>("get_sync_cursor"),
    advanceSyncCursor: (cursor) =>
      invokeCommand<void>("advance_sync_cursor", { cursor }),
    applyProjectChange: (input) =>
      invokeCommand<void>("apply_project_change", { input }),
    credentialStatus: () =>
      invokeCommand<CredentialStatus>("credential_status"),
    saveCredential: (credential) =>
      invokeCommand<CredentialStatus>("save_credential", {
        input: { credential }
      }),
    deleteCredential: () => invokeCommand<CredentialStatus>("delete_credential")
  };
}

export const desktopBridge = createDesktopBridge();
