import { randomUUID } from "node:crypto";

import {
  authorizeAction,
  validateProjectInput,
  type AccountStatus,
  type AuthorizationAction,
  type AuthorizationContext,
  type ProjectAuditChangeSummary,
  type ProjectAuditEvent,
  type ProjectInput,
  type ProjectLifecycle,
  type ProjectListFilters,
  type ProjectMemberRole,
  type ProjectPermissions,
  type ProjectRecord
} from "@project-online/domain";

import type { AuthStateStore, StoredUser } from "../../storage/auth-state.js";
import { AuthServiceError } from "../auth/auth-service.js";
import {
  AuthorizationService,
  type ProjectAuthorizationContext
} from "../authorization/authorization-service.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import type {
  ProjectAuditRecordPage,
  ProjectRepository
} from "./project-repository.js";
import { ProjectServiceError } from "./project-service-error.js";

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

export interface ProjectServiceDependencies {
  now: () => Date;
  generateId: () => string;
}

const defaultDependencies: ProjectServiceDependencies = {
  now: () => new Date(),
  generateId: randomUUID
};

const projectInputFields = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate"
] as const satisfies readonly (keyof ProjectInput)[];

function toUserSummary(user: StoredUser): ProjectUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountStatus: user.accountStatus
  };
}

function toAuditValue(value: ProjectInput[keyof ProjectInput]): string | null {
  return typeof value === "number" ? String(value) : value;
}

function changedProjectFields(
  current: ProjectRecord,
  input: ProjectInput
): readonly (keyof ProjectInput)[] {
  return projectInputFields.filter((field) => current[field] !== input[field]);
}

function projectChangeSummary(
  current: ProjectRecord,
  input: ProjectInput,
  fields: readonly (keyof ProjectInput)[]
): ProjectAuditChangeSummary {
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const field of fields) {
    before[field] = toAuditValue(current[field]);
    after[field] = toAuditValue(input[field]);
  }
  return { fields, before, after };
}

function authorizationContext(
  principal: AuthenticatedPrincipal,
  memberRole: ProjectMemberRole | null
): AuthorizationContext {
  return {
    accountStatus: "ACTIVE",
    credentialStatus: "READY",
    sessionValid: true,
    systemRole: principal.role,
    projectExists: true,
    memberRole
  };
}

export class ProjectService {
  private readonly dependencies: ProjectServiceDependencies;

  constructor(
    private readonly repository: ProjectRepository,
    private readonly authorization: AuthorizationService,
    private readonly authStore: AuthStateStore,
    dependencies: Partial<ProjectServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async listProjects(
    principal: AuthenticatedPrincipal,
    filters: ProjectListFilters
  ): Promise<ProjectPage> {
    await this.assertAuthorized(
      principal,
      {
        projectId: null,
        projectExists: true,
        memberRole: principal.role === "USER" ? "VIEWER" : null
      },
      "PROJECT_LIST",
      "FORBIDDEN"
    );
    const scope =
      principal.role === "USER" ? { userId: principal.userId } : "ALL";
    const page = await this.repository.listProjects(scope, filters);
    const projectIds = page.items.map(({ id }) => id);
    const owners = await this.repository.listOwnerUserIds(projectIds);
    const summaries = await this.readUserSummaries(
      owners.map(({ userId }) => userId)
    );
    const ownerIdsByProject = new Map<string, string[]>();
    for (const owner of owners) {
      const ownerIds = ownerIdsByProject.get(owner.projectId) ?? [];
      ownerIds.push(owner.userId);
      ownerIdsByProject.set(owner.projectId, ownerIds);
    }

    return {
      items: page.items.map((project) => ({
        project,
        owners: (ownerIdsByProject.get(project.id) ?? []).flatMap((userId) => {
          const summary = summaries.get(userId);
          return summary === undefined ? [] : [summary];
        })
      })),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total
    };
  }

  async createProject(
    principal: AuthenticatedPrincipal,
    input: CreateProjectInput
  ): Promise<ProjectDetails> {
    await this.assertAuthorized(
      principal,
      { projectId: null, projectExists: false, memberRole: null },
      "PROJECT_CREATE",
      "FORBIDDEN"
    );
    const owner = await this.requireAvailableUser(input.ownerUserId);
    if (!validateProjectInput(input.project).ok) {
      throw new ProjectServiceError(
        "VALIDATION_ERROR",
        "Project input is invalid"
      );
    }

    return this.repository.transaction(async (transaction) => {
      const commitSequence = await transaction.nextCommitSequence();
      const occurredAt = this.dependencies.now().toISOString();
      const project = await transaction.createProject({
        ...input.project,
        id: this.dependencies.generateId(),
        actorUserId: principal.userId,
        occurredAt,
        commitSequence
      });
      await transaction.addMember({
        id: this.dependencies.generateId(),
        projectId: project.id,
        userId: owner.id,
        memberRole: "OWNER",
        jobTitle: "",
        phone: "",
        remark: "",
        actorUserId: principal.userId,
        occurredAt
      });
      await transaction.writeAudit({
        id: this.dependencies.generateId(),
        projectId: project.id,
        commitSequence,
        eventType: "PROJECT_CREATED",
        actorUserId: principal.userId,
        targetType: "PROJECT",
        targetId: project.id,
        changeSummary: {
          fields: ["name", "year", "type", "status", "phase", "filingStatus"]
        },
        occurredAt
      });
      return this.details(
        principal,
        owner.id === principal.userId ? "OWNER" : null,
        project
      );
    });
  }

  getProject(
    principal: AuthenticatedPrincipal,
    projectId: string
  ): Promise<ProjectDetails> {
    return this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        false
      );
      await this.assertAuthorized(
        principal,
        this.projectAuthorizationContext(projectId, access),
        "PROJECT_READ",
        "PROJECT_NOT_FOUND"
      );
      if (access.project === null) {
        throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
      }
      return this.details(principal, access.memberRole, access.project);
    });
  }

  updateProject(
    principal: AuthenticatedPrincipal,
    projectId: string,
    input: ProjectInput
  ): Promise<ProjectDetails> {
    return this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        true
      );
      await this.assertAuthorized(
        principal,
        this.projectAuthorizationContext(projectId, access),
        "BUSINESS_UPDATE",
        "FORBIDDEN"
      );
      if (access.project === null) {
        throw new ProjectServiceError("FORBIDDEN", "Operation is not allowed");
      }
      if (access.project.lifecycle === "ARCHIVED") {
        throw new ProjectServiceError(
          "INVALID_PROJECT_STATE",
          "Archived projects are read-only"
        );
      }
      if (!validateProjectInput(input).ok) {
        throw new ProjectServiceError(
          "VALIDATION_ERROR",
          "Project input is invalid"
        );
      }
      const changedFields = changedProjectFields(access.project, input);
      if (changedFields.length === 0) {
        return this.details(principal, access.memberRole, access.project);
      }

      const commitSequence = await transaction.nextCommitSequence();
      const occurredAt = this.dependencies.now().toISOString();
      const project = await transaction.updateProject({
        ...input,
        projectId,
        actorUserId: principal.userId,
        occurredAt,
        commitSequence
      });
      if (project === null) {
        throw new ProjectServiceError("FORBIDDEN", "Operation is not allowed");
      }
      await transaction.writeAudit({
        id: this.dependencies.generateId(),
        projectId,
        commitSequence,
        eventType: "PROJECT_UPDATED",
        actorUserId: principal.userId,
        targetType: "PROJECT",
        targetId: projectId,
        changeSummary: projectChangeSummary(
          access.project,
          input,
          changedFields
        ),
        occurredAt
      });
      return this.details(principal, access.memberRole, project);
    });
  }

  archiveProject(
    principal: AuthenticatedPrincipal,
    projectId: string
  ): Promise<ProjectDetails> {
    return this.changeLifecycle(principal, projectId, "ARCHIVED");
  }

  restoreProject(
    principal: AuthenticatedPrincipal,
    projectId: string
  ): Promise<ProjectDetails> {
    return this.changeLifecycle(principal, projectId, "ACTIVE");
  }

  async listAuditEvents(
    principal: AuthenticatedPrincipal,
    projectId: string,
    page: number,
    pageSize: number
  ): Promise<ProjectAuditPage> {
    const auditPage = await this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        false
      );
      await this.assertAuthorized(
        principal,
        this.projectAuthorizationContext(projectId, access),
        "AUDIT_READ",
        "PROJECT_NOT_FOUND"
      );
      if (access.project === null) {
        throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
      }
      return transaction.listAudit(projectId, page, pageSize);
    });
    return this.withAuditActors(auditPage);
  }

  private async changeLifecycle(
    principal: AuthenticatedPrincipal,
    projectId: string,
    lifecycle: ProjectLifecycle
  ): Promise<ProjectDetails> {
    return this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        true
      );
      const action =
        lifecycle === "ARCHIVED" ? "PROJECT_ARCHIVE" : "PROJECT_RESTORE";
      await this.assertAuthorized(
        principal,
        this.projectAuthorizationContext(projectId, access),
        action,
        "FORBIDDEN"
      );
      if (access.project === null) {
        throw new ProjectServiceError("FORBIDDEN", "Operation is not allowed");
      }
      if (access.project.lifecycle === lifecycle) {
        throw new ProjectServiceError(
          "INVALID_PROJECT_STATE",
          "Project lifecycle is unchanged"
        );
      }

      const commitSequence = await transaction.nextCommitSequence();
      const occurredAt = this.dependencies.now().toISOString();
      const project = await transaction.setLifecycle({
        projectId,
        lifecycle,
        actorUserId: principal.userId,
        occurredAt,
        commitSequence
      });
      if (project === null) {
        throw new ProjectServiceError("FORBIDDEN", "Operation is not allowed");
      }
      await transaction.writeAudit({
        id: this.dependencies.generateId(),
        projectId,
        commitSequence,
        eventType:
          lifecycle === "ARCHIVED" ? "PROJECT_ARCHIVED" : "PROJECT_RESTORED",
        actorUserId: principal.userId,
        targetType: "PROJECT",
        targetId: projectId,
        changeSummary: {
          fields: ["lifecycle"],
          before: { lifecycle: access.project.lifecycle },
          after: { lifecycle }
        },
        occurredAt
      });
      return this.details(principal, access.memberRole, project);
    });
  }

  private details(
    principal: AuthenticatedPrincipal,
    memberRole: ProjectMemberRole | null,
    project: ProjectRecord
  ): ProjectDetails {
    const context = authorizationContext(principal, memberRole);
    const lifecycleAction =
      project.lifecycle === "ACTIVE" ? "PROJECT_ARCHIVE" : "PROJECT_RESTORE";
    return {
      project,
      permissions: {
        canEdit:
          project.lifecycle === "ACTIVE" &&
          authorizeAction(context, "BUSINESS_UPDATE").allowed,
        canManageMembers:
          project.lifecycle === "ACTIVE" &&
          authorizeAction(context, "MEMBER_MANAGE").allowed,
        canChangeLifecycle: authorizeAction(context, lifecycleAction).allowed,
        canReadAudit: authorizeAction(context, "AUDIT_READ").allowed
      }
    };
  }

  private projectAuthorizationContext(
    projectId: string,
    access: {
      project: ProjectRecord | null;
      memberRole: ProjectMemberRole | null;
    }
  ): ProjectAuthorizationContext {
    return {
      projectId,
      projectExists: access.project !== null,
      memberRole: access.memberRole
    };
  }

  private async assertAuthorized(
    principal: AuthenticatedPrincipal,
    project: ProjectAuthorizationContext,
    action: AuthorizationAction,
    deniedCode: "PROJECT_NOT_FOUND" | "FORBIDDEN"
  ): Promise<void> {
    const decision = await this.authorization.authorize(
      principal,
      project,
      action
    );
    if (decision.allowed) {
      return;
    }
    if (
      decision.reason === "ACCOUNT_DISABLED" ||
      decision.reason === "CREDENTIAL_NOT_READY" ||
      decision.reason === "SESSION_INVALID"
    ) {
      throw new AuthServiceError("INVALID_SESSION");
    }
    if (decision.reason === "PROJECT_NOT_FOUND") {
      throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
    }
    throw new ProjectServiceError(
      deniedCode,
      deniedCode === "PROJECT_NOT_FOUND"
        ? "Project not found"
        : "Operation is not allowed"
    );
  }

  private requireAvailableUser(userId: string): Promise<StoredUser> {
    return this.authStore.read((state) => {
      const user = state.users.find((candidate) => candidate.id === userId);
      if (
        user === undefined ||
        user.accountStatus !== "ACTIVE" ||
        user.credentialStatus !== "READY"
      ) {
        throw new ProjectServiceError(
          "USER_NOT_AVAILABLE",
          "Project owner is unavailable"
        );
      }
      return user;
    });
  }

  private readUserSummaries(
    userIds: readonly string[]
  ): Promise<Map<string, ProjectUserSummary>> {
    const selected = new Set(userIds);
    return this.authStore.read(
      (state) =>
        new Map(
          state.users
            .filter(({ id }) => selected.has(id))
            .map((user) => [user.id, toUserSummary(user)])
        )
    );
  }

  private async withAuditActors(
    page: ProjectAuditRecordPage
  ): Promise<ProjectAuditPage> {
    const summaries = await this.readUserSummaries(
      page.items.map(({ actorUserId }) => actorUserId)
    );
    return {
      items: page.items.map((event) => ({
        event,
        actor: summaries.get(event.actorUserId) ?? null
      })),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total
    };
  }
}
