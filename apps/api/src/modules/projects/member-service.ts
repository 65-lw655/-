import { randomUUID } from "node:crypto";

import {
  validateMemberInput,
  type AuthorizationAction,
  type MemberInput,
  type ProjectAuditChangeSummary,
  type ProjectMemberRecord,
  type ProjectMemberRole,
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
  ProjectRepository,
  ProjectTransaction
} from "./project-repository.js";
import { ProjectServiceError } from "./project-service-error.js";
import type { ProjectUserSummary } from "./project-service.js";

export interface ProjectMemberView {
  member: ProjectMemberRecord;
  user: ProjectUserSummary | null;
}

export interface MemberCandidate {
  id: string;
  username: string;
  displayName: string;
}

export type AddMemberInput = MemberInput & { userId: string };

export interface MemberServiceDependencies {
  now: () => Date;
  generateId: () => string;
}

const defaultDependencies: MemberServiceDependencies = {
  now: () => new Date(),
  generateId: randomUUID
};

const memberInputFields = [
  "memberRole",
  "jobTitle",
  "phone",
  "remark"
] as const satisfies readonly (keyof MemberInput)[];

function toUserSummary(user: StoredUser): ProjectUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountStatus: user.accountStatus
  };
}

function changedMemberFields(
  current: ProjectMemberRecord,
  input: MemberInput
): readonly (keyof MemberInput)[] {
  return memberInputFields.filter((field) => current[field] !== input[field]);
}

function memberChangeSummary(
  current: ProjectMemberRecord,
  input: MemberInput,
  fields: readonly (keyof MemberInput)[]
): ProjectAuditChangeSummary {
  const roleChanged = fields.includes("memberRole");
  return {
    fields,
    ...(roleChanged
      ? {
          before: { memberRole: current.memberRole },
          after: { memberRole: input.memberRole }
        }
      : {})
  };
}

function isProjectMemberUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "project_members_project_id_user_id_key"
  );
}

export class MemberService {
  private readonly dependencies: MemberServiceDependencies;

  constructor(
    private readonly repository: ProjectRepository,
    private readonly authorization: AuthorizationService,
    private readonly authStore: AuthStateStore,
    dependencies: Partial<MemberServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async listMembers(
    principal: AuthenticatedPrincipal,
    projectId: string
  ): Promise<ProjectMemberView[]> {
    const members = await this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        false
      );
      await this.assertAuthorized(principal, projectId, access, "PROJECT_READ");
      return transaction.listMembers(projectId);
    });
    return this.enrichMembers(members);
  }

  async searchCandidates(
    principal: AuthenticatedPrincipal,
    projectId: string,
    query: string
  ): Promise<MemberCandidate[]> {
    const trimmedQuery = query.trim();
    const normalizedQuery = trimmedQuery.toLocaleLowerCase();

    const existingUserIds = await this.repository.transaction(
      async (transaction) => {
        const access = await transaction.getAccess(
          projectId,
          principal.userId,
          false
        );
        await this.assertAuthorized(
          principal,
          projectId,
          access,
          "MEMBER_MANAGE"
        );
        this.assertActiveProject(access.project);
        if ([...trimmedQuery].length < 2) {
          throw new ProjectServiceError(
            "VALIDATION_ERROR",
            "Candidate query is too short"
          );
        }
        return new Set(
          (await transaction.listMembers(projectId)).map(({ userId }) => userId)
        );
      }
    );

    return this.authStore.read((state) =>
      state.users
        .filter(
          (user) =>
            user.accountStatus === "ACTIVE" && user.credentialStatus === "READY"
        )
        .filter((user) => !existingUserIds.has(user.id))
        .filter((user) =>
          `${user.username} ${user.displayName}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
        .slice(0, 20)
        .map(({ id, username, displayName }) => ({
          id,
          username,
          displayName
        }))
    );
  }

  async addMember(
    principal: AuthenticatedPrincipal,
    projectId: string,
    input: AddMemberInput
  ): Promise<ProjectMemberView> {
    try {
      const result = await this.repository.transaction(async (transaction) => {
        const access = await transaction.getAccess(
          projectId,
          principal.userId,
          true
        );
        await this.assertAuthorized(
          principal,
          projectId,
          access,
          "MEMBER_MANAGE"
        );
        this.assertActiveProject(access.project);
        if (!validateMemberInput(input).ok) {
          throw new ProjectServiceError(
            "VALIDATION_ERROR",
            "Member input is invalid"
          );
        }
        const user = await this.requireAvailableUser(input.userId);

        const commitSequence = await transaction.nextCommitSequence();
        const occurredAt = this.dependencies.now().toISOString();
        const created = await transaction.addMember({
          ...input,
          id: this.dependencies.generateId(),
          projectId,
          actorUserId: principal.userId,
          occurredAt
        });
        await this.touchProject(
          transaction,
          projectId,
          principal.userId,
          occurredAt,
          commitSequence
        );
        await transaction.writeAudit({
          id: this.dependencies.generateId(),
          projectId,
          commitSequence,
          eventType: "MEMBER_ADDED",
          actorUserId: principal.userId,
          targetType: "PROJECT_MEMBER",
          targetId: created.id,
          changeSummary: {
            fields: memberInputFields,
            after: { memberRole: created.memberRole }
          },
          occurredAt
        });
        return { member: created, user };
      });
      return { member: result.member, user: toUserSummary(result.user) };
    } catch (error) {
      if (isProjectMemberUniqueViolation(error)) {
        throw new ProjectServiceError(
          "MEMBER_ALREADY_EXISTS",
          "User is already a project member"
        );
      }
      throw error;
    }
  }

  async updateMember(
    principal: AuthenticatedPrincipal,
    projectId: string,
    memberId: string,
    input: MemberInput
  ): Promise<ProjectMemberView> {
    const member = await this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        true
      );
      await this.assertAuthorized(
        principal,
        projectId,
        access,
        "MEMBER_MANAGE"
      );
      this.assertActiveProject(access.project);
      const current = await transaction.getMember(projectId, memberId, true);
      if (current === null) {
        throw new ProjectServiceError("MEMBER_NOT_FOUND", "Member not found");
      }
      if (!validateMemberInput(input).ok) {
        throw new ProjectServiceError(
          "VALIDATION_ERROR",
          "Member input is invalid"
        );
      }
      const changedFields = changedMemberFields(current, input);
      if (changedFields.length === 0) {
        return current;
      }
      if (
        current.memberRole === "OWNER" &&
        input.memberRole !== "OWNER" &&
        (await transaction.countOwners(projectId)) === 1
      ) {
        throw new ProjectServiceError(
          "LAST_OWNER_REQUIRED",
          "At least one project owner is required"
        );
      }

      const commitSequence = await transaction.nextCommitSequence();
      const occurredAt = this.dependencies.now().toISOString();
      const updated = await transaction.updateMember({
        ...input,
        projectId,
        memberId,
        actorUserId: principal.userId,
        occurredAt
      });
      if (updated === null) {
        throw new ProjectServiceError("MEMBER_NOT_FOUND", "Member not found");
      }
      await this.touchProject(
        transaction,
        projectId,
        principal.userId,
        occurredAt,
        commitSequence
      );
      await transaction.writeAudit({
        id: this.dependencies.generateId(),
        projectId,
        commitSequence,
        eventType: "MEMBER_UPDATED",
        actorUserId: principal.userId,
        targetType: "PROJECT_MEMBER",
        targetId: updated.id,
        changeSummary: memberChangeSummary(current, input, changedFields),
        occurredAt
      });
      return updated;
    });
    return this.enrichMember(member);
  }

  async removeMember(
    principal: AuthenticatedPrincipal,
    projectId: string,
    memberId: string
  ): Promise<void> {
    await this.repository.transaction(async (transaction) => {
      const access = await transaction.getAccess(
        projectId,
        principal.userId,
        true
      );
      await this.assertAuthorized(
        principal,
        projectId,
        access,
        "MEMBER_MANAGE"
      );
      this.assertActiveProject(access.project);
      const current = await transaction.getMember(projectId, memberId, true);
      if (current === null) {
        throw new ProjectServiceError("MEMBER_NOT_FOUND", "Member not found");
      }
      if (
        current.memberRole === "OWNER" &&
        (await transaction.countOwners(projectId)) === 1
      ) {
        throw new ProjectServiceError(
          "LAST_OWNER_REQUIRED",
          "At least one project owner is required"
        );
      }

      const commitSequence = await transaction.nextCommitSequence();
      const occurredAt = this.dependencies.now().toISOString();
      const removed = await transaction.removeMember(projectId, memberId);
      if (removed === null) {
        throw new ProjectServiceError("MEMBER_NOT_FOUND", "Member not found");
      }
      await this.touchProject(
        transaction,
        projectId,
        principal.userId,
        occurredAt,
        commitSequence
      );
      await transaction.writeAudit({
        id: this.dependencies.generateId(),
        projectId,
        commitSequence,
        eventType: "MEMBER_REMOVED",
        actorUserId: principal.userId,
        targetType: "PROJECT_MEMBER",
        targetId: removed.id,
        changeSummary: {
          fields: memberInputFields,
          before: { memberRole: removed.memberRole }
        },
        occurredAt
      });
    });
  }

  private async assertAuthorized(
    principal: AuthenticatedPrincipal,
    projectId: string,
    access: {
      project: ProjectRecord | null;
      memberRole: ProjectMemberRole | null;
    },
    action: AuthorizationAction
  ): Promise<void> {
    const context: ProjectAuthorizationContext = {
      projectId,
      projectExists: access.project !== null,
      memberRole: access.memberRole
    };
    const decision = await this.authorization.authorize(
      principal,
      context,
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
    if (principal.role === "USER" && access.memberRole === null) {
      throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
    }
    throw new ProjectServiceError("FORBIDDEN", "Operation is not allowed");
  }

  private assertActiveProject(
    project: ProjectRecord | null
  ): asserts project is ProjectRecord {
    if (project === null) {
      throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
    }
    if (project.lifecycle === "ARCHIVED") {
      throw new ProjectServiceError(
        "INVALID_PROJECT_STATE",
        "Archived projects are read-only"
      );
    }
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
          "Project member is unavailable"
        );
      }
      return user;
    });
  }

  private async enrichMembers(
    members: readonly ProjectMemberRecord[]
  ): Promise<ProjectMemberView[]> {
    const selected = new Set(members.map(({ userId }) => userId));
    const users = await this.authStore.read(
      (state) =>
        new Map(
          state.users
            .filter(({ id }) => selected.has(id))
            .map((user) => [user.id, toUserSummary(user)])
        )
    );
    return members.map((member) => ({
      member,
      user: users.get(member.userId) ?? null
    }));
  }

  private async enrichMember(
    member: ProjectMemberRecord
  ): Promise<ProjectMemberView> {
    const [view] = await this.enrichMembers([member]);
    return view!;
  }

  private async touchProject(
    transaction: ProjectTransaction,
    projectId: string,
    actorUserId: string,
    occurredAt: string,
    commitSequence: number
  ): Promise<void> {
    const project = await transaction.touchProject(
      projectId,
      actorUserId,
      occurredAt,
      commitSequence
    );
    if (project === null) {
      throw new ProjectServiceError("PROJECT_NOT_FOUND", "Project not found");
    }
  }
}
