import { describe, expect, it } from "vitest";

import {
  MAX_PULL_PAGE_SIZE,
  MAX_PUSH_BATCH_SIZE,
  PROTOCOL_VERSION,
  isProjectSyncOperation,
  isPullProjectsQuery,
  isPushProjectsRequest,
  type ProjectSyncOperation
} from "./project-sync.js";

const uuid = "11111111-1111-4111-8111-111111111111";

function operation(
  overrides: Partial<ProjectSyncOperation> = {}
): ProjectSyncOperation {
  return {
    protocolVersion: PROTOCOL_VERSION,
    operationId: uuid,
    deviceId: "22222222-2222-4222-8222-222222222222",
    clientSequence: 1,
    entityType: "PROJECT",
    entityId: "33333333-3333-4333-8333-333333333333",
    projectId: "33333333-3333-4333-8333-333333333333",
    action: "UPSERT",
    baseRevision: 0,
    payload: {
      name: "示例项目",
      year: 2026,
      type: "展览",
      status: "施工中",
      phase: "实施",
      filingStatus: "未归档",
      plannedCompletionDate: null,
      actualCompletionDate: null
    },
    ...overrides
  };
}

describe("project sync protocol", () => {
  it("accepts a valid project upsert and delete envelope", () => {
    expect(isProjectSyncOperation(operation())).toBe(true);
    expect(
      isProjectSyncOperation(operation({ action: "DELETE", payload: {} }))
    ).toBe(true);
  });

  it("enforces protocol, UUIDs, and non-negative sequence values", () => {
    expect(isProjectSyncOperation({ ...operation(), protocolVersion: 2 })).toBe(
      false
    );
    expect(
      isProjectSyncOperation({ ...operation(), operationId: "not-a-uuid" })
    ).toBe(false);
    expect(isProjectSyncOperation({ ...operation(), clientSequence: 0 })).toBe(
      false
    );
    expect(isProjectSyncOperation({ ...operation(), baseRevision: -1 })).toBe(
      false
    );
  });

  it("rejects server-managed payload fields and unknown fields", () => {
    expect(
      isProjectSyncOperation({
        ...operation(),
        payload: { ...operation().payload, createdBy: uuid }
      })
    ).toBe(false);
    expect(
      isProjectSyncOperation({
        ...operation(),
        payload: { ...operation().payload, serverTimestamp: "now" }
      })
    ).toBe(false);
  });

  it("validates push and pull limits", () => {
    expect(MAX_PUSH_BATCH_SIZE).toBe(100);
    expect(MAX_PULL_PAGE_SIZE).toBe(500);
    expect(
      isPushProjectsRequest({
        protocolVersion: 1,
        deviceId: uuid,
        operations: [operation()]
      })
    ).toBe(true);
    expect(isPullProjectsQuery({ after: 0, limit: 500 })).toBe(true);
    expect(isPullProjectsQuery({ after: -1, limit: 500 })).toBe(false);
    expect(isPullProjectsQuery({ after: 0, limit: 501 })).toBe(false);
  });
});
