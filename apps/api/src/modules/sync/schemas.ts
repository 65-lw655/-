import {
  MAX_PULL_PAGE_SIZE,
  MAX_PUSH_BATCH_SIZE,
  PROJECT_ACCESS_REVOKED_CHANGE_TYPE,
  PROJECT_SYNC_RESULT_STATUSES,
  PROTOCOL_VERSION
} from "@project-online/sync";

import {
  apiErrorResponseSchemas,
  emptyObjectSchema
} from "../projects/schemas.js";

const uuidProperty = { type: "string", format: "uuid" } as const;
const dateProperty = { type: "string", format: "date" } as const;
const timestampProperty = { type: "string", format: "date-time" } as const;
const nullableDateProperty = {
  anyOf: [dateProperty, { type: "null" }]
} as const;

const projectSyncPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "year",
    "type",
    "status",
    "phase",
    "filingStatus",
    "plannedCompletionDate",
    "actualCompletionDate"
  ],
  properties: {
    name: { type: "string" },
    year: { type: "integer" },
    type: { type: "string" },
    status: { type: "string" },
    phase: { type: "string" },
    filingStatus: { type: "string" },
    plannedCompletionDate: nullableDateProperty,
    actualCompletionDate: nullableDateProperty
  }
} as const;

const syncOperationBaseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "protocolVersion",
    "operationId",
    "deviceId",
    "clientSequence",
    "entityType",
    "entityId",
    "projectId",
    "action",
    "baseRevision",
    "payload"
  ],
  properties: {
    protocolVersion: { type: "integer", const: PROTOCOL_VERSION },
    operationId: uuidProperty,
    deviceId: uuidProperty,
    clientSequence: { type: "integer", minimum: 1 },
    entityType: { type: "string", const: "PROJECT" },
    entityId: uuidProperty,
    projectId: uuidProperty,
    action: { type: "string" },
    baseRevision: { type: "integer", minimum: 0 },
    payload: {}
  }
} as const;

const upsertOperationSchema = {
  ...syncOperationBaseSchema,
  properties: {
    ...syncOperationBaseSchema.properties,
    action: { type: "string", const: "UPSERT" },
    payload: projectSyncPayloadSchema
  }
} as const;

const deleteOperationSchema = {
  ...syncOperationBaseSchema,
  properties: {
    ...syncOperationBaseSchema.properties,
    action: { type: "string", const: "DELETE" },
    payload: emptyObjectSchema
  }
} as const;

const pushProjectResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operationId", "status", "entityId"],
  properties: {
    operationId: uuidProperty,
    status: { type: "string", enum: PROJECT_SYNC_RESULT_STATUSES },
    entityId: uuidProperty,
    revision: { type: "integer" },
    commitSequence: { type: "integer" },
    conflict: { type: "boolean" },
    serverCommittedAt: timestampProperty
  }
} as const;

const projectChangeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "entityId",
    "projectId",
    "revision",
    "commitSequence",
    "deleted",
    "project"
  ],
  properties: {
    type: { type: "string", const: "PROJECT" },
    entityId: uuidProperty,
    projectId: uuidProperty,
    revision: { type: "integer" },
    commitSequence: { type: "integer" },
    deleted: { type: "boolean" },
    project: {
      anyOf: [projectSyncPayloadSchema, { type: "null" }]
    }
  }
} as const;

const projectAccessRevokedChangeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "projectId", "commitSequence"],
  properties: {
    type: { type: "string", const: PROJECT_ACCESS_REVOKED_CHANGE_TYPE },
    projectId: uuidProperty,
    commitSequence: { type: "integer" }
  }
} as const;

export const pushProjectsRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "deviceId", "operations"],
  properties: {
    protocolVersion: { type: "integer", const: PROTOCOL_VERSION },
    deviceId: uuidProperty,
    operations: {
      type: "array",
      minItems: 0,
      maxItems: MAX_PUSH_BATCH_SIZE,
      items: { oneOf: [upsertOperationSchema, deleteOperationSchema] }
    }
  }
} as const;

export const pushProjectsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "results"],
  properties: {
    protocolVersion: { type: "integer", const: PROTOCOL_VERSION },
    results: { type: "array", items: pushProjectResultSchema }
  }
} as const;

export const pullProjectsQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["after", "limit"],
  properties: {
    after: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: MAX_PULL_PAGE_SIZE }
  }
} as const;

export const pullProjectsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "changes", "nextCursor", "hasMore"],
  properties: {
    protocolVersion: { type: "integer", const: PROTOCOL_VERSION },
    changes: {
      type: "array",
      items: {
        oneOf: [projectChangeSchema, projectAccessRevokedChangeSchema]
      }
    },
    nextCursor: { type: "integer" },
    hasMore: { type: "boolean" }
  }
} as const;

export {
  apiErrorResponseSchemas,
  deleteOperationSchema,
  projectAccessRevokedChangeSchema,
  projectSyncPayloadSchema,
  pushProjectResultSchema,
  upsertOperationSchema
};
