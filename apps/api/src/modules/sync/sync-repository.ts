import type { ProjectRecord } from "@project-online/domain";
import type {
  PROJECT_ENTITY_TYPE,
  ProjectSyncPayload,
  ProjectSyncResultStatus,
  PushProjectResult
} from "@project-online/sync";

import type { ProjectTransaction } from "../projects/project-repository.js";

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

export interface ProjectSyncTransaction extends ProjectTransaction {
  findSyncOperationResult(
    deviceId: string,
    operationId: string
  ): Promise<StoredSyncOperationResult | null>;
  writeSyncOperationResult(input: WriteSyncOperationResult): Promise<void>;
  appendProjectChange(input: AppendProjectChange): Promise<void>;
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
