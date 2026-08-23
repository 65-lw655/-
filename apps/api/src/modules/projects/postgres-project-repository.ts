import {
  PROJECT_AUDIT_FIELDS,
  PROJECT_AUDIT_VALUE_FIELDS,
  type ProjectAuditChangeSummary,
  type ProjectAuditEvent,
  type ProjectAuditEventType,
  type ProjectAuditField,
  type ProjectAuditTargetType,
  type ProjectAuditValueField,
  type ProjectAuditValues,
  type ProjectLifecycle,
  type ProjectListFilters,
  type ProjectMemberRecord,
  type ProjectMemberRole,
  type ProjectRecord,
  type ProjectStatus
} from "@project-online/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  CreateMemberRecord,
  CreateProjectAuditEvent,
  CreateProjectRecord,
  ProjectAccessRecord,
  ProjectAuditRecordPage,
  ProjectRecordPage,
  ProjectRepository,
  ProjectTransaction,
  SetProjectLifecycleRecord,
  UpdateMemberRecord,
  UpdateProjectRecord
} from "./project-repository.js";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  year: number;
  type: string;
  status: ProjectStatus;
  phase: string;
  lifecycle: ProjectLifecycle;
  filing_status: string;
  planned_completion_date: string | null;
  actual_completion_date: string | null;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
  revision: number;
  commit_sequence: string | number;
  archived_at: string | Date | null;
  archived_by: string | null;
}

interface ProjectAccessRow extends ProjectRow {
  member_role: ProjectMemberRole | null;
}

interface ProjectMemberRow extends QueryResultRow {
  id: string;
  project_id: string;
  user_id: string;
  member_role: ProjectMemberRole;
  job_title: string;
  phone: string;
  remark: string;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
}

interface ProjectAuditRow extends QueryResultRow {
  id: string;
  project_id: string;
  commit_sequence: string | number;
  event_type: ProjectAuditEventType;
  actor_user_id: string;
  target_type: ProjectAuditTargetType;
  target_id: string;
  change_summary: unknown;
  occurred_at: string | Date;
}

interface ProjectOwnerUserIdRow extends QueryResultRow {
  project_id: string;
  user_id: string;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface SequenceRow extends QueryResultRow {
  value: string | number;
}

interface ProjectFilters {
  whereSql: string;
  values: unknown[];
}

const projectColumns = `projects.id,
       projects.name,
       projects.year,
       projects.type,
       projects.status,
       projects.phase,
       projects.lifecycle,
       projects.filing_status,
       projects.planned_completion_date::text AS planned_completion_date,
       projects.actual_completion_date::text AS actual_completion_date,
       projects.created_at,
       projects.created_by,
       projects.updated_at,
       projects.updated_by,
       projects.revision,
       projects.commit_sequence,
       projects.archived_at,
       projects.archived_by`;

function toSafeNumber(value: string | number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("PostgreSQL bigint exceeds the safe integer range");
  }
  return number;
}

function toDateOnly(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError("PostgreSQL project date mapping failed");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new TypeError("PostgreSQL project date mapping failed");
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
  const maximumDay = daysInMonth[month - 1] ?? 0;
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > maximumDay) {
    throw new TypeError("PostgreSQL project date mapping failed");
  }
  return value;
}

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("PostgreSQL timestamp is invalid");
  }
  return date.toISOString();
}

function requiredRow<Row>(rows: Row[], operation: string): Row {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${operation} did not return a row`);
  }
  return row;
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    type: row.type,
    status: row.status,
    phase: row.phase,
    lifecycle: row.lifecycle,
    filingStatus: row.filing_status,
    plannedCompletionDate: toDateOnly(row.planned_completion_date),
    actualCompletionDate: toDateOnly(row.actual_completion_date),
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by,
    revision: row.revision,
    commitSequence: toSafeNumber(row.commit_sequence),
    archivedAt: row.archived_at === null ? null : toIsoString(row.archived_at),
    archivedBy: row.archived_by
  };
}

function mapProjectMemberRow(row: ProjectMemberRow): ProjectMemberRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    memberRole: row.member_role,
    jobTitle: row.job_title,
    phone: row.phone,
    remark: row.remark,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by
  };
}

const projectAuditFields = new Set<string>(PROJECT_AUDIT_FIELDS);
const projectAuditValueFields = new Set<string>(PROJECT_AUDIT_VALUE_FIELDS);
const projectAuditSummaryKeys = new Set(["fields", "before", "after"]);

function auditMappingError(): TypeError {
  return new TypeError("PostgreSQL audit change summary mapping failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectAuditField(value: unknown): value is ProjectAuditField {
  return typeof value === "string" && projectAuditFields.has(value);
}

function isProjectAuditValueField(
  value: unknown
): value is ProjectAuditValueField {
  return typeof value === "string" && projectAuditValueFields.has(value);
}

function mapAuditValues(
  value: unknown,
  present: boolean
): ProjectAuditValues | undefined {
  if (!present) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw auditMappingError();
  }

  const mapped: Partial<Record<ProjectAuditValueField, string | null>> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (
      !isProjectAuditValueField(field) ||
      (fieldValue !== null && typeof fieldValue !== "string")
    ) {
      throw auditMappingError();
    }
    mapped[field] = fieldValue;
  }
  return mapped;
}

function mapChangeSummary(value: unknown): ProjectAuditChangeSummary {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    throw auditMappingError();
  }
  if (
    !isRecord(parsed) ||
    !Object.keys(parsed).every((key) => projectAuditSummaryKeys.has(key)) ||
    !Array.isArray(parsed.fields) ||
    !parsed.fields.every(isProjectAuditField)
  ) {
    throw auditMappingError();
  }

  const beforePresent = Object.hasOwn(parsed, "before");
  const afterPresent = Object.hasOwn(parsed, "after");
  const before = mapAuditValues(parsed.before, beforePresent);
  const after = mapAuditValues(parsed.after, afterPresent);
  return {
    fields: [...parsed.fields],
    ...(beforePresent ? { before: before! } : {}),
    ...(afterPresent ? { after: after! } : {})
  };
}

function mapProjectAuditRow(row: ProjectAuditRow): ProjectAuditEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    commitSequence: toSafeNumber(row.commit_sequence),
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    changeSummary: mapChangeSummary(row.change_summary),
    occurredAt: toIsoString(row.occurred_at)
  };
}

function buildProjectFilters(
  scope: "ALL" | { userId: string },
  filters: ProjectListFilters
): ProjectFilters {
  const conditions = [
    "($1::text IS NULL OR projects.name ILIKE '%' || $1 || '%')",
    "($2::integer IS NULL OR projects.year = $2)",
    "($3::text IS NULL OR projects.status = $3)",
    "($4::text IS NULL OR projects.lifecycle = $4)"
  ];
  const values: unknown[] = [
    filters.query ?? null,
    filters.year ?? null,
    filters.status ?? null,
    filters.lifecycle ?? null
  ];

  if (scope !== "ALL") {
    values.push(scope.userId);
    conditions.push(`EXISTS (
      SELECT 1
        FROM project_members pm
       WHERE pm.project_id = projects.id
         AND pm.user_id = $${values.length}::uuid
    )`);
  }

  return {
    whereSql: `WHERE ${conditions.join("\n  AND ")}`,
    values
  };
}

class PostgresProjectTransaction implements ProjectTransaction {
  constructor(private readonly client: PoolClient) {}

  async getAccess(
    projectId: string,
    userId: string,
    lock: boolean
  ): Promise<ProjectAccessRecord> {
    const result = await this.client.query<ProjectAccessRow>(
      `SELECT ${projectColumns}, pm.member_role
         FROM projects
         LEFT JOIN project_members pm
           ON pm.project_id = projects.id
          AND pm.user_id = $2
        WHERE projects.id = $1
        ${lock ? "FOR UPDATE OF projects" : ""}`,
      [projectId, userId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { project: null, memberRole: null };
    }
    return {
      project: mapProjectRow(row),
      memberRole: row.member_role
    };
  }

  async createProject(input: CreateProjectRecord): Promise<ProjectRecord> {
    const result = await this.client.query<ProjectRow>(
      `INSERT INTO projects (
         id, name, year, type, status, phase, lifecycle, filing_status,
         planned_completion_date, actual_completion_date,
         created_at, created_by, updated_at, updated_by,
         revision, commit_sequence, archived_at, archived_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'ACTIVE', $7,
         $8, $9, $10, $11, $10, $11, 1, $12, NULL, NULL
       )
       RETURNING ${projectColumns}`,
      [
        input.id,
        input.name,
        input.year,
        input.type,
        input.status,
        input.phase,
        input.filingStatus,
        input.plannedCompletionDate,
        input.actualCompletionDate,
        input.occurredAt,
        input.actorUserId,
        input.commitSequence
      ]
    );
    return mapProjectRow(requiredRow(result.rows, "createProject"));
  }

  async updateProject(
    input: UpdateProjectRecord
  ): Promise<ProjectRecord | null> {
    const result = await this.client.query<ProjectRow>(
      `UPDATE projects
          SET name = $2,
              year = $3,
              type = $4,
              status = $5,
              phase = $6,
              filing_status = $7,
              planned_completion_date = $8,
              actual_completion_date = $9,
              updated_at = $10,
              updated_by = $11,
              revision = revision + 1,
              commit_sequence = $12
        WHERE id = $1
        RETURNING ${projectColumns}`,
      [
        input.projectId,
        input.name,
        input.year,
        input.type,
        input.status,
        input.phase,
        input.filingStatus,
        input.plannedCompletionDate,
        input.actualCompletionDate,
        input.occurredAt,
        input.actorUserId,
        input.commitSequence
      ]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectRow(row);
  }

  async setLifecycle(
    input: SetProjectLifecycleRecord
  ): Promise<ProjectRecord | null> {
    const result = await this.client.query<ProjectRow>(
      `UPDATE projects
          SET lifecycle = $2::varchar(16),
              updated_at = $4,
              updated_by = $3,
              revision = revision + 1,
              commit_sequence = $5,
              archived_at = CASE
                WHEN $2::varchar(16) = 'ARCHIVED' THEN $4::timestamptz
                ELSE NULL
              END,
              archived_by = CASE
                WHEN $2::varchar(16) = 'ARCHIVED' THEN $3::uuid
                ELSE NULL
              END
        WHERE id = $1
        RETURNING ${projectColumns}`,
      [
        input.projectId,
        input.lifecycle,
        input.actorUserId,
        input.occurredAt,
        input.commitSequence
      ]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectRow(row);
  }

  async touchProject(
    projectId: string,
    actorUserId: string,
    occurredAt: string,
    commitSequence: number
  ): Promise<ProjectRecord | null> {
    const result = await this.client.query<ProjectRow>(
      `UPDATE projects
          SET updated_at = $3,
              updated_by = $2,
              revision = revision + 1,
              commit_sequence = $4
        WHERE id = $1
        RETURNING ${projectColumns}`,
      [projectId, actorUserId, occurredAt, commitSequence]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectRow(row);
  }

  async getMember(
    projectId: string,
    memberId: string,
    lock: boolean
  ): Promise<ProjectMemberRecord | null> {
    const result = await this.client.query<ProjectMemberRow>(
      `SELECT *
         FROM project_members
        WHERE project_id = $1
          AND id = $2
        ${lock ? "FOR UPDATE" : ""}`,
      [projectId, memberId]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectMemberRow(row);
  }

  async listMembers(projectId: string): Promise<ProjectMemberRecord[]> {
    const result = await this.client.query<ProjectMemberRow>(
      `SELECT *
         FROM project_members
        WHERE project_id = $1
        ORDER BY created_at ASC, id ASC`,
      [projectId]
    );
    return result.rows.map(mapProjectMemberRow);
  }

  async addMember(input: CreateMemberRecord): Promise<ProjectMemberRecord> {
    const result = await this.client.query<ProjectMemberRow>(
      `INSERT INTO project_members (
         id, project_id, user_id, member_role, job_title, phone, remark,
         created_at, created_by, updated_at, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9)
       RETURNING *`,
      [
        input.id,
        input.projectId,
        input.userId,
        input.memberRole,
        input.jobTitle,
        input.phone,
        input.remark,
        input.occurredAt,
        input.actorUserId
      ]
    );
    return mapProjectMemberRow(requiredRow(result.rows, "addMember"));
  }

  async updateMember(
    input: UpdateMemberRecord
  ): Promise<ProjectMemberRecord | null> {
    const result = await this.client.query<ProjectMemberRow>(
      `UPDATE project_members
          SET member_role = $3,
              job_title = $4,
              phone = $5,
              remark = $6,
              updated_at = $7,
              updated_by = $8
        WHERE project_id = $1
          AND id = $2
        RETURNING *`,
      [
        input.projectId,
        input.memberId,
        input.memberRole,
        input.jobTitle,
        input.phone,
        input.remark,
        input.occurredAt,
        input.actorUserId
      ]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectMemberRow(row);
  }

  async removeMember(
    projectId: string,
    memberId: string
  ): Promise<ProjectMemberRecord | null> {
    const result = await this.client.query<ProjectMemberRow>(
      `DELETE FROM project_members
        WHERE project_id = $1
          AND id = $2
        RETURNING *`,
      [projectId, memberId]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjectMemberRow(row);
  }

  async countOwners(projectId: string): Promise<number> {
    const result = await this.client.query<CountRow>(
      `SELECT count(*)::text AS total
         FROM project_members
        WHERE project_id = $1
          AND member_role = 'OWNER'`,
      [projectId]
    );
    return toSafeNumber(requiredRow(result.rows, "countOwners").total);
  }

  async writeAudit(event: CreateProjectAuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO project_audit_events (
         id, project_id, commit_sequence, event_type, actor_user_id,
         target_type, target_id, change_summary, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        event.id,
        event.projectId,
        event.commitSequence,
        event.eventType,
        event.actorUserId,
        event.targetType,
        event.targetId,
        JSON.stringify(event.changeSummary),
        event.occurredAt
      ]
    );
  }

  async listAudit(
    projectId: string,
    page: number,
    pageSize: number
  ): Promise<ProjectAuditRecordPage> {
    const offset = (page - 1) * pageSize;
    const countResult = await this.client.query<CountRow>(
      `SELECT count(*)::text AS total
         FROM project_audit_events
        WHERE project_id = $1`,
      [projectId]
    );
    const pageResult = await this.client.query<ProjectAuditRow>(
      `SELECT *
         FROM project_audit_events
        WHERE project_id = $1
        ORDER BY commit_sequence DESC, id ASC
        LIMIT $2 OFFSET $3`,
      [projectId, pageSize, offset]
    );
    return {
      items: pageResult.rows.map(mapProjectAuditRow),
      page,
      pageSize,
      total: toSafeNumber(requiredRow(countResult.rows, "listAudit").total)
    };
  }

  async nextCommitSequence(): Promise<number> {
    const result = await this.client.query<SequenceRow>(
      "SELECT nextval('project_commit_sequence')::text AS value"
    );
    return toSafeNumber(requiredRow(result.rows, "nextCommitSequence").value);
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async listProjects(
    scope: "ALL" | { userId: string },
    filters: ProjectListFilters
  ): Promise<ProjectRecordPage> {
    const projectFilters = buildProjectFilters(scope, filters);
    const countResult = await this.pool.query<CountRow>(
      `SELECT count(*)::text AS total
         FROM projects
        ${projectFilters.whereSql}`,
      projectFilters.values
    );
    const limitParameter = projectFilters.values.length + 1;
    const offsetParameter = projectFilters.values.length + 2;
    const offset = (filters.page - 1) * filters.pageSize;
    const pageResult = await this.pool.query<ProjectRow>(
      `SELECT ${projectColumns}
         FROM projects
        ${projectFilters.whereSql}
        ORDER BY projects.updated_at DESC, projects.id ASC
        LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      [...projectFilters.values, filters.pageSize, offset]
    );
    return {
      items: pageResult.rows.map(mapProjectRow),
      page: filters.page,
      pageSize: filters.pageSize,
      total: toSafeNumber(requiredRow(countResult.rows, "listProjects").total)
    };
  }

  async listOwnerUserIds(
    projectIds: string[]
  ): Promise<readonly { projectId: string; userId: string }[]> {
    if (projectIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<ProjectOwnerUserIdRow>(
      `SELECT project_id, user_id
         FROM project_members
        WHERE project_id = ANY($1::uuid[])
          AND member_role = 'OWNER'
        ORDER BY project_id ASC, created_at ASC, id ASC`,
      [projectIds]
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      userId: row.user_id
    }));
  }

  async transaction<T>(
    work: (transaction: ProjectTransaction) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresProjectTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
