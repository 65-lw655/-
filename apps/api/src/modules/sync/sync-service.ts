import { randomUUID } from "node:crypto";

import {
  validateProjectInput,
  type AuthorizationAction,
  type ProjectAuditChangeSummary,
  type ProjectAuditField,
  type ProjectAuditValueField,
  type ProjectInput,
  type ProjectRecord
} from "@project-online/domain";
import {
  PROTOCOL_VERSION,
  isPullProjectsQuery,
  isProjectSyncOperation,
  type PullProjectsQuery,
  type PullProjectsResponse,
  type ProjectSyncOperation,
  type ProjectSyncPayload,
  type ProjectSyncResultStatus,
  type PushProjectResult,
  type PushProjectsRequest,
  type PushProjectsResponse
} from "@project-online/sync";

import { AuthServiceError } from "../auth/auth-service.js";
import {
  AuthorizationService,
  type ProjectAuthorizationContext
} from "../authorization/authorization-service.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";
import {
  projectSnapshot,
  type ProjectSyncRepository,
  type ProjectSyncTransaction
} from "./sync-repository.js";

export interface SyncServiceDependencies {
  now: () => Date;
  generateId: () => string;
}

const defaultDependencies: SyncServiceDependencies = {
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

function toProjectInput(payload: ProjectSyncPayload): ProjectInput {
  return {
    name: payload.name,
    year: payload.year,
    type: payload.type,
    status: payload.status as ProjectInput["status"],
    phase: payload.phase,
    filingStatus: payload.filingStatus,
    plannedCompletionDate: payload.plannedCompletionDate,
    actualCompletionDate: payload.actualCompletionDate
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
  const before: Partial<Record<ProjectAuditValueField, string | null>> = {};
  const after: Partial<Record<ProjectAuditValueField, string | null>> = {};
  for (const field of fields) {
    before[field] = toAuditValue(current[field]);
    after[field] = toAuditValue(input[field]);
  }
  return { fields, before, after };
}

function syncProjectChangeSummary(
  current: ProjectRecord,
  input: ProjectInput,
  fields: readonly (keyof ProjectInput)[]
): ProjectAuditChangeSummary {
  const summary = projectChangeSummary(current, input, fields);
  if (current.lifecycle !== "ARCHIVED") {
    return summary;
  }
  return {
    fields: [...summary.fields, "lifecycle"] as ProjectAuditField[],
    before: { ...summary.before, lifecycle: current.lifecycle },
    after: { ...summary.after, lifecycle: "ACTIVE" }
  };
}

function projectAuthorizationContext(
  projectId: string,
  projectExists: boolean,
  memberRole: ProjectAuthorizationContext["memberRole"]
): ProjectAuthorizationContext {
  return { projectId, projectExists, memberRole };
}

function resultFor(
  operation: Pick<ProjectSyncOperation, "operationId" | "entityId">,
  status: ProjectSyncResultStatus,
  extra: Omit<PushProjectResult, "operationId" | "status" | "entityId"> = {}
): PushProjectResult {
  return {
    operationId: operation.operationId,
    status,
    entityId: operation.entityId,
    ...extra
  };
}

export class SyncService {
  private readonly dependencies: SyncServiceDependencies;

  constructor(
    private readonly repository: ProjectSyncRepository,
    private readonly authorization: AuthorizationService,
    dependencies: Partial<SyncServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async pushProjects(
    principal: AuthenticatedPrincipal,
    request: PushProjectsRequest
  ): Promise<PushProjectsResponse> {
    if (request.protocolVersion !== PROTOCOL_VERSION) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        results: request.operations.map((operation) =>
          resultFor(operation, "PROTOCOL_UNSUPPORTED")
        )
      };
    }

    const results: PushProjectResult[] = [];
    for (const operation of request.operations) {
      results.push(await this.pushOne(principal, request.deviceId, operation));
    }
    return { protocolVersion: PROTOCOL_VERSION, results };
  }

  async pullProjects(
    principal: AuthenticatedPrincipal,
    query: PullProjectsQuery
  ): Promise<PullProjectsResponse> {
    if (!isPullProjectsQuery(query)) {
      throw new TypeError("Invalid project sync pull query");
    }

    await this.isAllowed(
      principal,
      {
        projectId: null,
        projectExists: true,
        memberRole: principal.role === "USER" ? "VIEWER" : null
      },
      "PROJECT_LIST"
    );

    const scope =
      principal.role === "USER" ? { userId: principal.userId } : "ALL";
    const changes = await this.repository.transaction((transaction) =>
      transaction.listProjectChanges(scope, query.after, query.limit + 1)
    );
    const page = changes.slice(0, query.limit);
    return {
      protocolVersion: PROTOCOL_VERSION,
      changes: page,
      nextCursor: page.at(-1)?.commitSequence ?? query.after,
      hasMore: changes.length > query.limit
    };
  }

  private pushOne(
    principal: AuthenticatedPrincipal,
    requestDeviceId: string,
    operation: ProjectSyncOperation
  ): Promise<PushProjectResult> {
    return this.repository.transaction(async (transaction) => {
      await transaction.lockSyncOperationResult(
        requestDeviceId,
        operation.operationId
      );
      const stored = await transaction.findSyncOperationResult(
        requestDeviceId,
        operation.operationId
      );
      if (stored !== null) {
        return stored.result;
      }

      if (
        operation.deviceId !== requestDeviceId ||
        !isProjectSyncOperation(operation)
      ) {
        return this.persistResult(
          transaction,
          principal,
          requestDeviceId,
          operation,
          "VALIDATION_FAILED"
        );
      }

      const access = await transaction.getAccess(
        operation.projectId,
        principal.userId,
        true
      );
      if (access.project === null) {
        return this.persistResult(
          transaction,
          principal,
          requestDeviceId,
          operation,
          "NOT_FOUND"
        );
      }

      const allowed = await this.isAllowed(
        principal,
        projectAuthorizationContext(
          operation.projectId,
          true,
          access.memberRole
        ),
        "SYNC_WRITE"
      );
      if (!allowed) {
        return this.persistResult(
          transaction,
          principal,
          requestDeviceId,
          operation,
          "FORBIDDEN"
        );
      }

      return operation.action === "DELETE"
        ? this.acceptDelete(
            transaction,
            principal,
            requestDeviceId,
            operation,
            access.project
          )
        : this.acceptUpsert(
            transaction,
            principal,
            requestDeviceId,
            operation,
            access.project
          );
    });
  }

  private async acceptUpsert(
    transaction: ProjectSyncTransaction,
    principal: AuthenticatedPrincipal,
    requestDeviceId: string,
    operation: ProjectSyncOperation,
    current: ProjectRecord
  ): Promise<PushProjectResult> {
    const input = toProjectInput(operation.payload as ProjectSyncPayload);
    if (!validateProjectInput(input).ok) {
      return this.persistResult(
        transaction,
        principal,
        requestDeviceId,
        operation,
        "VALIDATION_FAILED"
      );
    }

    const commitSequence = await transaction.nextCommitSequence();
    const occurredAt = this.dependencies.now().toISOString();
    const project = await transaction.upsertProjectFromSync({
      ...input,
      projectId: operation.projectId,
      actorUserId: principal.userId,
      occurredAt,
      commitSequence
    });
    if (project === null) {
      return this.persistResult(
        transaction,
        principal,
        requestDeviceId,
        operation,
        "NOT_FOUND"
      );
    }

    const changedFields = changedProjectFields(current, input);
    await transaction.writeAudit({
      id: this.dependencies.generateId(),
      projectId: project.id,
      commitSequence,
      eventType: "PROJECT_UPDATED",
      actorUserId: principal.userId,
      targetType: "PROJECT",
      targetId: project.id,
      changeSummary: syncProjectChangeSummary(current, input, changedFields),
      occurredAt
    });
    await transaction.appendProjectChange({
      commitSequence,
      projectId: project.id,
      entityId: project.id,
      entityType: "PROJECT",
      revision: project.revision,
      deleted: false,
      projectSnapshot: projectSnapshot(project),
      actorUserId: principal.userId,
      changedAt: occurredAt
    });
    return this.persistResult(
      transaction,
      principal,
      requestDeviceId,
      operation,
      "ACCEPTED",
      {
        revision: project.revision,
        commitSequence,
        conflict: operation.baseRevision < current.revision,
        serverCommittedAt: occurredAt
      }
    );
  }

  private async acceptDelete(
    transaction: ProjectSyncTransaction,
    principal: AuthenticatedPrincipal,
    requestDeviceId: string,
    operation: ProjectSyncOperation,
    current: ProjectRecord
  ): Promise<PushProjectResult> {
    const commitSequence = await transaction.nextCommitSequence();
    const occurredAt = this.dependencies.now().toISOString();
    const project = await transaction.setLifecycle({
      projectId: operation.projectId,
      lifecycle: "ARCHIVED",
      actorUserId: principal.userId,
      occurredAt,
      commitSequence
    });
    if (project === null) {
      return this.persistResult(
        transaction,
        principal,
        requestDeviceId,
        operation,
        "NOT_FOUND"
      );
    }

    await transaction.writeAudit({
      id: this.dependencies.generateId(),
      projectId: project.id,
      commitSequence,
      eventType: "PROJECT_ARCHIVED",
      actorUserId: principal.userId,
      targetType: "PROJECT",
      targetId: project.id,
      changeSummary: {
        fields: ["lifecycle"],
        before: { lifecycle: current.lifecycle },
        after: { lifecycle: "ARCHIVED" }
      },
      occurredAt
    });
    await transaction.appendProjectChange({
      commitSequence,
      projectId: project.id,
      entityId: project.id,
      entityType: "PROJECT",
      revision: project.revision,
      deleted: true,
      projectSnapshot: null,
      actorUserId: principal.userId,
      changedAt: occurredAt
    });
    return this.persistResult(
      transaction,
      principal,
      requestDeviceId,
      operation,
      "ACCEPTED",
      {
        revision: project.revision,
        commitSequence,
        conflict: operation.baseRevision < current.revision,
        serverCommittedAt: occurredAt
      }
    );
  }

  private async persistResult(
    transaction: ProjectSyncTransaction,
    principal: AuthenticatedPrincipal,
    requestDeviceId: string,
    operation: Pick<
      ProjectSyncOperation,
      "operationId" | "projectId" | "entityId" | "entityType"
    >,
    status: ProjectSyncResultStatus,
    extra: Omit<PushProjectResult, "operationId" | "status" | "entityId"> = {}
  ): Promise<PushProjectResult> {
    const result = resultFor(operation, status, extra);
    await transaction.writeSyncOperationResult({
      deviceId: requestDeviceId,
      operationId: operation.operationId,
      projectId: operation.projectId,
      entityId: operation.entityId,
      entityType: operation.entityType,
      status,
      result,
      errorCode: status === "ACCEPTED" ? null : status,
      createdAt:
        extra.serverCommittedAt ?? this.dependencies.now().toISOString(),
      actorUserId: principal.userId
    });
    return result;
  }

  private async isAllowed(
    principal: AuthenticatedPrincipal,
    project: ProjectAuthorizationContext,
    action: AuthorizationAction
  ): Promise<boolean> {
    const decision = await this.authorization.authorize(
      principal,
      project,
      action
    );
    if (decision.allowed) {
      return true;
    }
    if (
      decision.reason === "ACCOUNT_DISABLED" ||
      decision.reason === "CREDENTIAL_NOT_READY" ||
      decision.reason === "SESSION_INVALID"
    ) {
      throw new AuthServiceError("INVALID_SESSION");
    }
    return false;
  }
}
