import {
  PROJECT_AUDIT_FIELDS,
  PROJECT_AUDIT_VALUE_FIELDS,
  PROJECT_STATUSES
} from "@project-online/domain";

const uuidProperty = { type: "string", format: "uuid" } as const;
const timestampProperty = { type: "string", format: "date-time" } as const;
const nullableDateProperty = {
  anyOf: [{ type: "string", format: "date" }, { type: "null" }]
} as const;
const nullableTimestampProperty = {
  anyOf: [timestampProperty, { type: "null" }]
} as const;
const nullableStringProperty = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;
const auditChangeValueProperties = Object.fromEntries(
  PROJECT_AUDIT_VALUE_FIELDS.map((field) => [field, nullableStringProperty])
);

export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" }
  }
} as const;

export const apiErrorResponseSchemas = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  500: errorResponseSchema
} as const;

export const emptyObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

export const projectParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectId"],
  properties: { projectId: uuidProperty }
} as const;

export const projectMemberParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectId", "memberId"],
  properties: {
    projectId: uuidProperty,
    memberId: uuidProperty
  }
} as const;

export const projectInputSchema = {
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
    name: { type: "string", minLength: 1, maxLength: 200 },
    year: { type: "integer", minimum: 1900, maximum: 2100 },
    type: { type: "string", maxLength: 100 },
    status: { type: "string", enum: PROJECT_STATUSES },
    phase: { type: "string", maxLength: 100 },
    filingStatus: { type: "string", maxLength: 100 },
    plannedCompletionDate: nullableDateProperty,
    actualCompletionDate: nullableDateProperty
  }
} as const;

export const createProjectBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["project", "ownerUserId"],
  properties: {
    project: projectInputSchema,
    ownerUserId: uuidProperty
  }
} as const;

const projectRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...projectInputSchema.required,
    "id",
    "lifecycle",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "revision",
    "commitSequence",
    "archivedAt",
    "archivedBy"
  ],
  properties: {
    ...projectInputSchema.properties,
    id: uuidProperty,
    lifecycle: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
    createdAt: timestampProperty,
    createdBy: uuidProperty,
    updatedAt: timestampProperty,
    updatedBy: uuidProperty,
    revision: { type: "integer" },
    commitSequence: { type: "integer" },
    archivedAt: nullableTimestampProperty,
    archivedBy: {
      anyOf: [uuidProperty, { type: "null" }]
    }
  }
} as const;

const projectUserSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "username", "displayName", "accountStatus"],
  properties: {
    id: uuidProperty,
    username: { type: "string" },
    displayName: { type: "string" },
    accountStatus: { type: "string", enum: ["ACTIVE", "DISABLED"] }
  }
} as const;

const projectPermissionsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "canEdit",
    "canManageMembers",
    "canChangeLifecycle",
    "canReadAudit"
  ],
  properties: {
    canEdit: { type: "boolean" },
    canManageMembers: { type: "boolean" },
    canChangeLifecycle: { type: "boolean" },
    canReadAudit: { type: "boolean" }
  }
} as const;

export const projectDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["project", "permissions"],
  properties: {
    project: projectRecordSchema,
    permissions: projectPermissionsSchema
  }
} as const;

export const projectPageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "page", "pageSize", "total"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["project", "owners"],
        properties: {
          project: projectRecordSchema,
          owners: { type: "array", items: projectUserSummarySchema }
        }
      }
    },
    page: { type: "integer" },
    pageSize: { type: "integer" },
    total: { type: "integer" }
  }
} as const;

export const projectListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    year: { type: "integer", minimum: 1900, maximum: 2100 },
    status: { type: "string", enum: PROJECT_STATUSES },
    lifecycle: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
} as const;

export const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
} as const;

const auditChangeValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: auditChangeValueProperties
} as const;

const auditEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "projectId",
    "commitSequence",
    "eventType",
    "actorUserId",
    "targetType",
    "targetId",
    "changeSummary",
    "occurredAt"
  ],
  properties: {
    id: uuidProperty,
    projectId: uuidProperty,
    commitSequence: { type: "integer" },
    eventType: {
      type: "string",
      enum: [
        "PROJECT_CREATED",
        "PROJECT_UPDATED",
        "PROJECT_ARCHIVED",
        "PROJECT_RESTORED",
        "MEMBER_ADDED",
        "MEMBER_UPDATED",
        "MEMBER_REMOVED"
      ]
    },
    actorUserId: uuidProperty,
    targetType: { type: "string", enum: ["PROJECT", "PROJECT_MEMBER"] },
    targetId: uuidProperty,
    changeSummary: {
      type: "object",
      additionalProperties: false,
      required: ["fields"],
      properties: {
        fields: {
          type: "array",
          items: { type: "string", enum: PROJECT_AUDIT_FIELDS }
        },
        before: auditChangeValueSchema,
        after: auditChangeValueSchema
      }
    },
    occurredAt: timestampProperty
  }
} as const;

export const auditPageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "page", "pageSize", "total"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["event", "actor"],
        properties: {
          event: auditEventSchema,
          actor: {
            anyOf: [projectUserSummarySchema, { type: "null" }]
          }
        }
      }
    },
    page: { type: "integer" },
    pageSize: { type: "integer" },
    total: { type: "integer" }
  }
} as const;

export const memberInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memberRole", "jobTitle", "phone", "remark"],
  properties: {
    memberRole: { type: "string", enum: ["OWNER", "EDITOR", "VIEWER"] },
    jobTitle: { type: "string", maxLength: 100 },
    phone: { type: "string", maxLength: 50 },
    remark: { type: "string", maxLength: 1000 }
  }
} as const;

export const addMemberBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId", ...memberInputSchema.required],
  properties: {
    userId: uuidProperty,
    ...memberInputSchema.properties
  }
} as const;

const projectMemberRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "projectId",
    "userId",
    ...memberInputSchema.required,
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
  ],
  properties: {
    id: uuidProperty,
    projectId: uuidProperty,
    userId: uuidProperty,
    ...memberInputSchema.properties,
    createdAt: timestampProperty,
    createdBy: uuidProperty,
    updatedAt: timestampProperty,
    updatedBy: uuidProperty
  }
} as const;

export const memberViewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["member", "user"],
  properties: {
    member: projectMemberRecordSchema,
    user: { anyOf: [projectUserSummarySchema, { type: "null" }] }
  }
} as const;

export const candidateQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: { query: { type: "string", minLength: 2 } }
} as const;

export const candidateResultsSchema = {
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "username", "displayName"],
    properties: {
      id: uuidProperty,
      username: { type: "string" },
      displayName: { type: "string" }
    }
  }
} as const;
