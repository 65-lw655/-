import { randomUUID } from "node:crypto";

import type {
  SecurityAuditEventType,
  SecurityAuditResult,
  StoredSecurityAuditEvent
} from "../../storage/auth-state.js";

export interface CreateSecurityAuditEventInput {
  event: SecurityAuditEventType;
  result: SecurityAuditResult;
  actorId: string | null;
  targetId: string | null;
  projectId: string | null;
  sourceDigest: string | null;
  occurredAt: string;
}

export function createSecurityAuditEvent(
  input: CreateSecurityAuditEventInput
): StoredSecurityAuditEvent {
  return {
    id: randomUUID(),
    event: input.event,
    result: input.result,
    actorId: input.actorId,
    targetId: input.targetId,
    projectId: input.projectId,
    sourceDigest: input.sourceDigest,
    occurredAt: input.occurredAt
  };
}
