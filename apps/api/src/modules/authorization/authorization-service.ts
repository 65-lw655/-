import { randomUUID } from "node:crypto";

import {
  authorizeAction,
  type AuthorizationAction,
  type AuthorizationContext,
  type AuthorizationDecision,
  type ProjectMemberRole
} from "@project-online/domain";

import type { AuthStateStore } from "../../storage/auth-state.js";
import type { AuthenticatedPrincipal } from "../users/user-service.js";

export interface ProjectAuthorizationContext {
  projectId: string | null;
  projectExists: boolean;
  memberRole: ProjectMemberRole | null;
}

export interface AuthorizationServiceDependencies {
  now: () => Date;
  generateId: () => string;
}

const defaultDependencies: AuthorizationServiceDependencies = {
  now: () => new Date(),
  generateId: randomUUID
};

export class AuthorizationService {
  private readonly dependencies: AuthorizationServiceDependencies;

  constructor(
    private readonly store: AuthStateStore,
    dependencies: Partial<AuthorizationServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  authorize(
    principal: AuthenticatedPrincipal,
    project: ProjectAuthorizationContext,
    action: AuthorizationAction
  ): Promise<AuthorizationDecision> {
    return this.store.update((state) => {
      const now = this.dependencies.now();
      const user = state.users.find(({ id }) => id === principal.userId);
      const session = state.sessions.find(
        (candidate) =>
          candidate.id === principal.sessionId &&
          candidate.userId === principal.userId
      );
      const context: AuthorizationContext = {
        accountStatus: user?.accountStatus ?? "ACTIVE",
        credentialStatus: user?.credentialStatus ?? "READY",
        sessionValid:
          user !== undefined &&
          session !== undefined &&
          session.revokedAt === null &&
          Date.parse(session.expiresAt) > now.getTime(),
        systemRole: user?.role ?? "USER",
        projectExists: project.projectExists,
        memberRole: project.memberRole
      };
      const decision = authorizeAction(context, action);

      if (!decision.allowed) {
        state.auditEvents.push({
          id: this.dependencies.generateId(),
          event: "AUTHORIZATION_DENIED",
          result: "DENIED",
          actorId: user?.id ?? null,
          targetId: null,
          projectId: project.projectId,
          sourceDigest: null,
          occurredAt: now.toISOString()
        });
      }
      return decision;
    });
  }
}
