import {
  PROJECT_AUDIT_FIELDS,
  PROJECT_AUDIT_VALUE_FIELDS,
  PROJECT_STATUSES,
  type AccountStatus,
  type CredentialStatus,
  type MemberInput,
  type ProjectAuditEvent,
  type ProjectAuditValues,
  type ProjectInput,
  type ProjectLifecycle,
  type ProjectListFilters,
  type ProjectMemberRecord,
  type ProjectPermissions,
  type ProjectRecord,
  type ProjectStatus,
  type SystemRole
} from "@project-online/domain";

import { ApiClientError, createApiClient } from "../../api-client.js";

export type {
  MemberInput,
  ProjectInput,
  ProjectLifecycle,
  ProjectListFilters,
  ProjectStatus
};

export interface ProjectUserSummary {
  id: string;
  username: string;
  displayName: string;
  accountStatus: AccountStatus;
}

export interface ProjectListItem {
  project: ProjectRecord;
  owners: ProjectUserSummary[];
}

export interface ProjectPage {
  items: ProjectListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectDetails {
  project: ProjectRecord;
  permissions: ProjectPermissions;
}

export interface ProjectMemberView {
  member: ProjectMemberRecord;
  user: ProjectUserSummary | null;
}

export interface MemberCandidate {
  id: string;
  username: string;
  displayName: string;
}

export interface ProjectAuditView {
  event: ProjectAuditEvent;
  actor: ProjectUserSummary | null;
}

export interface ProjectAuditPage {
  items: ProjectAuditView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProjectInput {
  project: ProjectInput;
  ownerUserId: string;
}

export type AddMemberInput = MemberInput & { userId: string };

export interface ProjectsClient {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  listInitialOwnerCandidates(): Promise<MemberCandidate[]>;
  createProject(input: CreateProjectInput): Promise<ProjectDetails>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(
    projectId: string,
    input: ProjectInput
  ): Promise<ProjectDetails>;
  archiveProject(projectId: string): Promise<ProjectDetails>;
  restoreProject(projectId: string): Promise<ProjectDetails>;
  listMembers(projectId: string): Promise<ProjectMemberView[]>;
  searchMemberCandidates(
    projectId: string,
    query: string
  ): Promise<MemberCandidate[]>;
  addMember(
    projectId: string,
    input: AddMemberInput
  ): Promise<ProjectMemberView>;
  updateMember(
    projectId: string,
    memberId: string,
    input: MemberInput
  ): Promise<ProjectMemberView>;
  removeMember(projectId: string, memberId: string): Promise<void>;
  listAuditEvents(projectId: string, page: number): Promise<ProjectAuditPage>;
}

interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  role: SystemRole;
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  createdAt: string;
  updatedAt: string;
}

const JSON_HEADERS = {
  accept: "application/json",
  "content-type": "application/json"
};

const READ_HEADERS = { accept: "application/json" };
const projectMemberRoles = ["OWNER", "EDITOR", "VIEWER"] as const;
const lifecycles = ["ACTIVE", "ARCHIVED"] as const;
const auditEventTypes = [
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_ARCHIVED",
  "PROJECT_RESTORED",
  "MEMBER_ADDED",
  "MEMBER_UPDATED",
  "MEMBER_REMOVED"
] as const;
const auditTargetTypes = ["PROJECT", "PROJECT_MEMBER"] as const;
const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function invalidResponse(status: number): ApiClientError {
  return new ApiClientError(status, "INVALID_RESPONSE", "API 响应无效");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = datePattern.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]!
  );
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = dateTimePattern.exec(value);
  if (match === null) {
    return false;
  }

  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match;
  if (
    !isDateOnly(`${year}-${month}-${day}`) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined &&
      (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNullableDateOnly(value: unknown): value is string | null {
  return value === null || isDateOnly(value);
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isProjectInput(value: unknown): value is ProjectInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "name",
      "year",
      "type",
      "status",
      "phase",
      "filingStatus",
      "plannedCompletionDate",
      "actualCompletionDate"
    ]) &&
    typeof value.name === "string" &&
    isInteger(value.year) &&
    typeof value.type === "string" &&
    isOneOf(value.status, PROJECT_STATUSES) &&
    typeof value.phase === "string" &&
    typeof value.filingStatus === "string" &&
    isNullableDateOnly(value.plannedCompletionDate) &&
    isNullableDateOnly(value.actualCompletionDate)
  );
}

function isProjectRecord(value: unknown): value is ProjectRecord {
  if (!isRecord(value)) {
    return false;
  }

  const projectInput = {
    name: value.name,
    year: value.year,
    type: value.type,
    status: value.status,
    phase: value.phase,
    filingStatus: value.filingStatus,
    plannedCompletionDate: value.plannedCompletionDate,
    actualCompletionDate: value.actualCompletionDate
  };
  return (
    hasExactKeys(value, [
      "name",
      "year",
      "type",
      "status",
      "phase",
      "filingStatus",
      "plannedCompletionDate",
      "actualCompletionDate",
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
    ]) &&
    isProjectInput(projectInput) &&
    isUuid(value.id) &&
    isOneOf(value.lifecycle, lifecycles) &&
    isDateTime(value.createdAt) &&
    isUuid(value.createdBy) &&
    isDateTime(value.updatedAt) &&
    isUuid(value.updatedBy) &&
    isInteger(value.revision) &&
    isInteger(value.commitSequence) &&
    isNullableDateTime(value.archivedAt) &&
    isNullableUuid(value.archivedBy)
  );
}

function isProjectUserSummary(value: unknown): value is ProjectUserSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "username", "displayName", "accountStatus"]) &&
    isUuid(value.id) &&
    typeof value.username === "string" &&
    typeof value.displayName === "string" &&
    isOneOf(value.accountStatus, ["ACTIVE", "DISABLED"])
  );
}

function isProjectPermissions(value: unknown): value is ProjectPermissions {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "canEdit",
      "canManageMembers",
      "canChangeLifecycle",
      "canReadAudit"
    ]) &&
    typeof value.canEdit === "boolean" &&
    typeof value.canManageMembers === "boolean" &&
    typeof value.canChangeLifecycle === "boolean" &&
    typeof value.canReadAudit === "boolean"
  );
}

function isProjectDetails(value: unknown): value is ProjectDetails {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["project", "permissions"]) &&
    isProjectRecord(value.project) &&
    isProjectPermissions(value.permissions)
  );
}

function isProjectPage(value: unknown): value is ProjectPage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items", "page", "pageSize", "total"]) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, ["project", "owners"]) &&
        isProjectRecord(item.project) &&
        Array.isArray(item.owners) &&
        item.owners.every(isProjectUserSummary)
    ) &&
    isInteger(value.page) &&
    isInteger(value.pageSize) &&
    isInteger(value.total)
  );
}

function isMemberInput(value: unknown): value is MemberInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["memberRole", "jobTitle", "phone", "remark"]) &&
    isOneOf(value.memberRole, projectMemberRoles) &&
    typeof value.jobTitle === "string" &&
    typeof value.phone === "string" &&
    typeof value.remark === "string"
  );
}

function isProjectMemberRecord(value: unknown): value is ProjectMemberRecord {
  if (!isRecord(value)) {
    return false;
  }

  const memberInput = {
    memberRole: value.memberRole,
    jobTitle: value.jobTitle,
    phone: value.phone,
    remark: value.remark
  };
  return (
    hasExactKeys(value, [
      "id",
      "projectId",
      "userId",
      "memberRole",
      "jobTitle",
      "phone",
      "remark",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy"
    ]) &&
    isMemberInput(memberInput) &&
    isUuid(value.id) &&
    isUuid(value.projectId) &&
    isUuid(value.userId) &&
    isDateTime(value.createdAt) &&
    isUuid(value.createdBy) &&
    isDateTime(value.updatedAt) &&
    isUuid(value.updatedBy)
  );
}

function isProjectMemberView(value: unknown): value is ProjectMemberView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["member", "user"]) &&
    isProjectMemberRecord(value.member) &&
    (value.user === null || isProjectUserSummary(value.user))
  );
}

function isMemberCandidate(value: unknown): value is MemberCandidate {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "username", "displayName"]) &&
    isUuid(value.id) &&
    typeof value.username === "string" &&
    typeof value.displayName === "string"
  );
}

function isAuditValues(value: unknown): value is ProjectAuditValues {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, PROJECT_AUDIT_VALUE_FIELDS) &&
    Object.values(value).every(isNullableString)
  );
}

function isProjectAuditEvent(value: unknown): value is ProjectAuditEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !hasExactKeys(value, [
      "id",
      "projectId",
      "commitSequence",
      "eventType",
      "actorUserId",
      "targetType",
      "targetId",
      "changeSummary",
      "occurredAt"
    ]) ||
    !isRecord(value.changeSummary) ||
    !hasOnlyKeys(value.changeSummary, ["fields", "before", "after"]) ||
    !Array.isArray(value.changeSummary.fields) ||
    !value.changeSummary.fields.every((field) =>
      isOneOf(field, PROJECT_AUDIT_FIELDS)
    )
  ) {
    return false;
  }

  return (
    isUuid(value.id) &&
    isUuid(value.projectId) &&
    isInteger(value.commitSequence) &&
    isOneOf(value.eventType, auditEventTypes) &&
    isUuid(value.actorUserId) &&
    isOneOf(value.targetType, auditTargetTypes) &&
    isUuid(value.targetId) &&
    isDateTime(value.occurredAt) &&
    (value.changeSummary.before === undefined ||
      isAuditValues(value.changeSummary.before)) &&
    (value.changeSummary.after === undefined ||
      isAuditValues(value.changeSummary.after))
  );
}

function isProjectAuditPage(value: unknown): value is ProjectAuditPage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items", "page", "pageSize", "total"]) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, ["event", "actor"]) &&
        isProjectAuditEvent(item.event) &&
        (item.actor === null || isProjectUserSummary(item.actor))
    ) &&
    isInteger(value.page) &&
    isInteger(value.pageSize) &&
    isInteger(value.total)
  );
}

function isManagedUser(value: unknown): value is ManagedUser {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "username",
      "displayName",
      "role",
      "accountStatus",
      "credentialStatus",
      "createdAt",
      "updatedAt"
    ]) &&
    isUuid(value.id) &&
    typeof value.username === "string" &&
    typeof value.displayName === "string" &&
    isOneOf(value.role, ["USER", "LEADER", "ADMIN"]) &&
    isOneOf(value.accountStatus, ["ACTIVE", "DISABLED"]) &&
    isOneOf(value.credentialStatus, [
      "PENDING_ACTIVATION",
      "READY",
      "RESET_REQUIRED"
    ]) &&
    isDateTime(value.createdAt) &&
    isDateTime(value.updatedAt)
  );
}

async function readJson<T>(
  response: Response,
  guard: (value: unknown) => value is T
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }

  if (!guard(payload)) {
    throw invalidResponse(response.status);
  }

  return payload;
}

function projectPath(projectId: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}`;
}

function projectMemberPath(projectId: string, memberId: string): string {
  return `${projectPath(projectId)}/members/${encodeURIComponent(memberId)}`;
}

function projectListPath(filters: ProjectListFilters): string {
  const query = new URLSearchParams();
  if (filters.query !== undefined) query.set("query", filters.query);
  if (filters.year !== undefined) query.set("year", String(filters.year));
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.lifecycle !== undefined)
    query.set("lifecycle", filters.lifecycle);
  query.set("page", String(filters.page));
  query.set("pageSize", String(filters.pageSize));
  return `/v1/projects?${query.toString()}`;
}

export function createProjectsClient(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): ProjectsClient {
  const apiClient = createApiClient(apiBaseUrl, fetchImpl);

  async function read<T>(
    path: string,
    guard: (value: unknown) => value is T
  ): Promise<T> {
    const response = await apiClient.request(path, {
      cache: "no-store",
      headers: READ_HEADERS
    });
    return readJson(response, guard);
  }

  async function mutate<T>(
    path: string,
    method: "POST" | "PATCH",
    body: object,
    guard: (value: unknown) => value is T
  ): Promise<T> {
    const response = await apiClient.request(path, {
      method,
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    });
    return readJson(response, guard);
  }

  return {
    listProjects(filters) {
      return read(projectListPath(filters), isProjectPage);
    },
    async listInitialOwnerCandidates() {
      const users = await read(
        "/v1/users",
        (value): value is ManagedUser[] =>
          Array.isArray(value) && value.every(isManagedUser)
      );
      return users
        .filter(
          ({ accountStatus, credentialStatus }) =>
            accountStatus === "ACTIVE" && credentialStatus === "READY"
        )
        .map(({ id, username, displayName }) => ({
          id,
          username,
          displayName
        }));
    },
    createProject(input) {
      return mutate("/v1/projects", "POST", input, isProjectDetails);
    },
    getProject(projectId) {
      return read(projectPath(projectId), isProjectDetails);
    },
    updateProject(projectId, input) {
      return mutate(projectPath(projectId), "PATCH", input, isProjectDetails);
    },
    archiveProject(projectId) {
      return mutate(
        `${projectPath(projectId)}/archive`,
        "POST",
        {},
        isProjectDetails
      );
    },
    restoreProject(projectId) {
      return mutate(
        `${projectPath(projectId)}/restore`,
        "POST",
        {},
        isProjectDetails
      );
    },
    listMembers(projectId) {
      return read(
        `${projectPath(projectId)}/members`,
        (value): value is ProjectMemberView[] =>
          Array.isArray(value) && value.every(isProjectMemberView)
      );
    },
    searchMemberCandidates(projectId, query) {
      const search = new URLSearchParams({ query });
      return read(
        `${projectPath(projectId)}/member-candidates?${search.toString()}`,
        (value): value is MemberCandidate[] =>
          Array.isArray(value) && value.every(isMemberCandidate)
      );
    },
    addMember(projectId, input) {
      return mutate(
        `${projectPath(projectId)}/members`,
        "POST",
        input,
        isProjectMemberView
      );
    },
    updateMember(projectId, memberId, input) {
      return mutate(
        projectMemberPath(projectId, memberId),
        "PATCH",
        input,
        isProjectMemberView
      );
    },
    async removeMember(projectId, memberId) {
      await apiClient.request(projectMemberPath(projectId, memberId), {
        method: "DELETE",
        headers: READ_HEADERS
      });
    },
    listAuditEvents(projectId, page) {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      return read(
        `${projectPath(projectId)}/audit-events?${query.toString()}`,
        isProjectAuditPage
      );
    }
  };
}
