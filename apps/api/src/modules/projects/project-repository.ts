import type {
  MemberInput,
  ProjectAuditEvent,
  ProjectInput,
  ProjectLifecycle,
  ProjectListFilters,
  ProjectMemberRecord,
  ProjectMemberRole,
  ProjectRecord
} from "@project-online/domain";

export interface ProjectAccessRecord {
  project: ProjectRecord | null;
  memberRole: ProjectMemberRole | null;
}

export interface ProjectRecordPage {
  items: ProjectRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectAuditRecordPage {
  items: ProjectAuditEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export type CreateProjectRecord = ProjectInput & {
  id: string;
  actorUserId: string;
  occurredAt: string;
  commitSequence: number;
};

export type UpdateProjectRecord = ProjectInput & {
  projectId: string;
  actorUserId: string;
  occurredAt: string;
  commitSequence: number;
};

export interface SetProjectLifecycleRecord {
  projectId: string;
  lifecycle: ProjectLifecycle;
  actorUserId: string;
  occurredAt: string;
  commitSequence: number;
}

export type CreateMemberRecord = MemberInput & {
  id: string;
  projectId: string;
  userId: string;
  actorUserId: string;
  occurredAt: string;
};

export type UpdateMemberRecord = MemberInput & {
  projectId: string;
  memberId: string;
  actorUserId: string;
  occurredAt: string;
};

export type CreateProjectAuditEvent = ProjectAuditEvent;

export interface ProjectRepository {
  listProjects(
    scope: "ALL" | { userId: string },
    filters: ProjectListFilters
  ): Promise<ProjectRecordPage>;
  listOwnerUserIds(
    projectIds: string[]
  ): Promise<readonly { projectId: string; userId: string }[]>;
  transaction<T>(
    work: (transaction: ProjectTransaction) => Promise<T>
  ): Promise<T>;
}

export interface ProjectTransaction {
  getAccess(
    projectId: string,
    userId: string,
    lock: boolean
  ): Promise<ProjectAccessRecord>;
  createProject(input: CreateProjectRecord): Promise<ProjectRecord>;
  updateProject(input: UpdateProjectRecord): Promise<ProjectRecord | null>;
  setLifecycle(input: SetProjectLifecycleRecord): Promise<ProjectRecord | null>;
  touchProject(
    projectId: string,
    actorUserId: string,
    occurredAt: string,
    commitSequence: number
  ): Promise<ProjectRecord | null>;
  getMember(
    projectId: string,
    memberId: string,
    lock: boolean
  ): Promise<ProjectMemberRecord | null>;
  listMembers(projectId: string): Promise<ProjectMemberRecord[]>;
  addMember(input: CreateMemberRecord): Promise<ProjectMemberRecord>;
  updateMember(input: UpdateMemberRecord): Promise<ProjectMemberRecord | null>;
  removeMember(
    projectId: string,
    memberId: string
  ): Promise<ProjectMemberRecord | null>;
  countOwners(projectId: string): Promise<number>;
  writeAudit(event: CreateProjectAuditEvent): Promise<void>;
  listAudit(
    projectId: string,
    page: number,
    pageSize: number
  ): Promise<ProjectAuditRecordPage>;
  nextCommitSequence(): Promise<number>;
}
