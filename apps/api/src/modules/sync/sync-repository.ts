import type { ProjectRecord } from "@project-online/domain";
import type {
  PROJECT_ENTITY_TYPE,
  ProjectChange,
  ProjectSyncPayload,
  ProjectSyncResultStatus,
  PushProjectResult
} from "@project-online/sync";

import type {
  ProjectTransaction,
  UpdateProjectRecord
} from "../projects/project-repository.js";

export interface StoredSyncOperationResult {
  deviceId: string;
  operationId: string;
  projectId: string;
  entityId: string;
  entityType: typeof PROJECT_ENTITY_TYPE;
  status: ProjectSyncResultStatus;
  result: PushProjectResult;
  errorCode: string | null;
  createdAt: string;
  actorUserId: string;
}

export interface WriteSyncOperationResult {
  deviceId: string;
  operationId: string;
  projectId: string;
  entityId: string;
  entityType: typeof PROJECT_ENTITY_TYPE;
  status: ProjectSyncResultStatus;
  result: PushProjectResult;
  errorCode: string | null;
  createdAt: string;
  actorUserId: string;
}

export interface AppendProjectChange {
  commitSequence: number;
  projectId: string;
  entityId: string;
  entityType: typeof PROJECT_ENTITY_TYPE;
  revision: number;
  deleted: boolean;
  projectSnapshot: ProjectSyncPayload | null;
  actorUserId: string;
  changedAt: string;
}

export type ProjectChangeReadScope = "ALL" | { userId: string };

export interface ProjectSyncTransaction extends ProjectTransaction {
  lockSyncOperationResult(deviceId: string, operationId: string): Promise<void>;
  findSyncOperationResult(
    deviceId: string,
    operationId: string
  ): Promise<StoredSyncOperationResult | null>;
  upsertProjectFromSync(
    input: UpdateProjectRecord
  ): Promise<ProjectRecord | null>;
  writeSyncOperationResult(input: WriteSyncOperationResult): Promise<void>;
  appendProjectChange(input: AppendProjectChange): Promise<void>;
  listProjectChanges(
    scope: ProjectChangeReadScope,
    after: number,
    limit: number
  ): Promise<ProjectChange[]>;
}

export interface ProjectSyncRepository {
  transaction<T>(
    work: (transaction: ProjectSyncTransaction) => Promise<T>
  ): Promise<T>;
}

export function projectSnapshot(project: ProjectRecord): ProjectSyncPayload {
  return {
    name: project.name,
    year: project.year,
    type: project.type,
    status: project.status,
    phase: project.phase,
    filingStatus: project.filingStatus,
    plannedCompletionDate: project.plannedCompletionDate,
    actualCompletionDate: project.actualCompletionDate
  };
}
