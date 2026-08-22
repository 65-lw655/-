import type { ProjectMemberRole } from "../auth/types.js";

export const PROJECT_STATUSES = [
  "中标待签",
  "施工中",
  "深化中",
  "完工未验收",
  "待验收",
  "验收未结算",
  "结算未回款",
  "已结算待回款"
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectLifecycle = "ACTIVE" | "ARCHIVED";

export interface ProjectInput {
  name: string;
  year: number;
  type: string;
  status: ProjectStatus;
  phase: string;
  filingStatus: string;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
}

export interface ProjectRecord extends ProjectInput {
  id: string;
  lifecycle: ProjectLifecycle;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  revision: number;
  commitSequence: number;
  archivedAt: string | null;
  archivedBy: string | null;
}

export interface MemberInput {
  memberRole: ProjectMemberRole;
  jobTitle: string;
  phone: string;
  remark: string;
}

export interface ProjectMemberRecord extends MemberInput {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProjectListFilters {
  query?: string;
  year?: number;
  status?: ProjectStatus;
  lifecycle?: ProjectLifecycle;
  page: number;
  pageSize: number;
}

export interface ProjectPermissions {
  canEdit: boolean;
  canManageMembers: boolean;
  canChangeLifecycle: boolean;
  canReadAudit: boolean;
}

export type ProjectAuditEventType =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_ARCHIVED"
  | "PROJECT_RESTORED"
  | "MEMBER_ADDED"
  | "MEMBER_UPDATED"
  | "MEMBER_REMOVED";

export type ProjectAuditTargetType = "PROJECT" | "PROJECT_MEMBER";

export const PROJECT_AUDIT_FIELDS = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate",
  "lifecycle",
  "memberRole",
  "jobTitle",
  "phone",
  "remark"
] as const;

export type ProjectAuditField = (typeof PROJECT_AUDIT_FIELDS)[number];

export const PROJECT_AUDIT_VALUE_FIELDS = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate",
  "lifecycle",
  "memberRole"
] as const;

export type ProjectAuditValueField =
  (typeof PROJECT_AUDIT_VALUE_FIELDS)[number];
export type ProjectAuditValues = Readonly<
  Partial<Record<ProjectAuditValueField, string | null>>
>;

export interface ProjectAuditChangeSummary {
  fields: readonly ProjectAuditField[];
  before?: ProjectAuditValues;
  after?: ProjectAuditValues;
}

export interface ProjectAuditEvent {
  id: string;
  projectId: string;
  commitSequence: number;
  eventType: ProjectAuditEventType;
  actorUserId: string;
  targetType: ProjectAuditTargetType;
  targetId: string;
  changeSummary: ProjectAuditChangeSummary;
  occurredAt: string;
}

export type ValidationResult =
  { ok: true } | { ok: false; fields: Readonly<Record<string, string>> };
