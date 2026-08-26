export const PROTOCOL_VERSION = 1 as const;
export const MAX_PUSH_BATCH_SIZE = 100 as const;
export const MAX_PULL_PAGE_SIZE = 500 as const;

export const PROJECT_ENTITY_TYPE = "PROJECT" as const;
export const PROJECT_ACCESS_REVOKED_CHANGE_TYPE =
  "PROJECT_ACCESS_REVOKED" as const;
export const PROJECT_SYNC_ACTIONS = ["UPSERT", "DELETE"] as const;
export type ProjectSyncAction = (typeof PROJECT_SYNC_ACTIONS)[number];

export const PROJECT_SYNC_RESULT_STATUSES = [
  "ACCEPTED",
  "DUPLICATE",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "RETRYABLE",
  "PROTOCOL_UNSUPPORTED"
] as const;
export type ProjectSyncResultStatus =
  (typeof PROJECT_SYNC_RESULT_STATUSES)[number];

export interface ProjectSyncPayload {
  name: string;
  year: number;
  type: string;
  status: string;
  phase: string;
  filingStatus: string;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
}

export interface ProjectSyncOperation {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  deviceId: string;
  clientSequence: number;
  entityType: typeof PROJECT_ENTITY_TYPE;
  entityId: string;
  projectId: string;
  action: ProjectSyncAction;
  baseRevision: number;
  payload: ProjectSyncPayload | Record<string, never>;
}

export interface PushProjectsRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  deviceId: string;
  operations: ProjectSyncOperation[];
}

export interface PushProjectResult {
  operationId: string;
  status: ProjectSyncResultStatus;
  entityId: string;
  revision?: number;
  commitSequence?: number;
  conflict?: boolean;
  serverCommittedAt?: string;
}

export interface PushProjectsResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  results: PushProjectResult[];
}

export interface PullProjectsQuery {
  after: number;
  limit: number;
}

export interface ProjectChange {
  type: typeof PROJECT_ENTITY_TYPE;
  entityId: string;
  projectId: string;
  revision: number;
  commitSequence: number;
  deleted: boolean;
  project: ProjectSyncPayload | null;
}

export interface ProjectAccessRevokedChange {
  type: typeof PROJECT_ACCESS_REVOKED_CHANGE_TYPE;
  projectId: string;
  commitSequence: number;
}

export type PullProjectsChange = ProjectChange | ProjectAccessRevokedChange;

export interface PullProjectsResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  changes: PullProjectsChange[];
  nextCursor: number;
  hasMore: boolean;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const projectPayloadFields = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate"
] as const;

function isProjectPayload(value: unknown): value is ProjectSyncPayload {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== projectPayloadFields.length
  ) {
    return false;
  }
  return (
    typeof value.name === "string" &&
    Number.isInteger(value.year) &&
    typeof value.type === "string" &&
    typeof value.status === "string" &&
    typeof value.phase === "string" &&
    typeof value.filingStatus === "string" &&
    (typeof value.plannedCompletionDate === "string" ||
      value.plannedCompletionDate === null) &&
    (typeof value.actualCompletionDate === "string" ||
      value.actualCompletionDate === null) &&
    projectPayloadFields.every((field) => Object.hasOwn(value, field))
  );
}

function isEmptyPayload(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

export function isProjectSyncOperation(
  value: unknown
): value is ProjectSyncOperation {
  if (!isRecord(value)) return false;
  if (
    value.protocolVersion !== PROTOCOL_VERSION ||
    !isUuid(value.operationId) ||
    !isUuid(value.deviceId) ||
    !isNonNegativeInteger(value.clientSequence) ||
    value.clientSequence === 0 ||
    value.entityType !== PROJECT_ENTITY_TYPE ||
    !isUuid(value.entityId) ||
    !isUuid(value.projectId) ||
    !PROJECT_SYNC_ACTIONS.includes(value.action as ProjectSyncAction) ||
    !isNonNegativeInteger(value.baseRevision)
  ) {
    return false;
  }
  return value.action === "DELETE"
    ? isEmptyPayload(value.payload)
    : isProjectPayload(value.payload);
}

export function isPushProjectsRequest(
  value: unknown
): value is PushProjectsRequest {
  return (
    isRecord(value) &&
    value.protocolVersion === PROTOCOL_VERSION &&
    isUuid(value.deviceId) &&
    Array.isArray(value.operations) &&
    value.operations.length <= MAX_PUSH_BATCH_SIZE &&
    value.operations.every(isProjectSyncOperation)
  );
}

export function isPullProjectsQuery(
  value: unknown
): value is PullProjectsQuery {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.after) &&
    isNonNegativeInteger(value.limit) &&
    value.limit >= 1 &&
    value.limit <= MAX_PULL_PAGE_SIZE
  );
}

export function assertProjectSyncOperation(
  value: unknown
): asserts value is ProjectSyncOperation {
  if (!isProjectSyncOperation(value)) {
    throw new Error("Invalid project sync operation");
  }
}
