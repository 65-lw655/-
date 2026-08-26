import type { ProjectSyncOperation } from "@project-online/sync";
import { describe, expect, it, vi } from "vitest";

import { syncProjectsOnce, type SyncBridge } from "./sync-client.js";
import type { PendingOutboxItem } from "../platform/desktop-bridge.js";

const operation: ProjectSyncOperation = {
  protocolVersion: 1,
  operationId: "00000000-0000-4000-8000-000000000001",
  deviceId: "00000000-0000-4000-8000-000000000002",
  clientSequence: 1,
  entityType: "PROJECT",
  entityId: "00000000-0000-4000-8000-000000000003",
  projectId: "00000000-0000-4000-8000-000000000003",
  action: "UPSERT",
  baseRevision: 1,
  payload: {
    name: "本地项目",
    year: 2026,
    type: "展览展示",
    status: "施工中",
    phase: "现场实施",
    filingStatus: "无需报建",
    plannedCompletionDate: null,
    actualCompletionDate: null
  }
};

function bridge(): SyncBridge {
  const pending: PendingOutboxItem = {
    operationId: operation.operationId,
    protocolVersion: 1,
    deviceId: operation.deviceId,
    clientSequence: 1,
    entityType: "PROJECT",
    entityId: operation.entityId,
    projectId: operation.projectId,
    action: "UPSERT",
    baseRevision: 1,
    payloadJson: JSON.stringify(operation.payload),
    attempts: 0,
    lastError: null
  };
  return {
    pendingOutbox: vi.fn(async () => [pending]),
    acknowledgeOutbox: vi.fn(async () => undefined),
    recordOutboxFailure: vi.fn(async () => undefined),
    getSyncCursor: vi.fn(async () => 0),
    advanceSyncCursor: vi.fn(async () => undefined),
    applyProjectChange: vi.fn(async () => undefined)
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("syncProjectsOnce", () => {
  it("pushes pending operations, applies pulls, and keeps the cursor monotonic", async () => {
    const local = bridge();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          results: [
            {
              operationId: operation.operationId,
              status: "ACCEPTED",
              entityId: operation.entityId,
              revision: 2,
              commitSequence: 10
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          changes: [
            {
              type: "PROJECT",
              entityId: operation.entityId,
              projectId: operation.projectId,
              revision: 3,
              commitSequence: 11,
              deleted: false,
              project: operation.payload
            }
          ],
          nextCursor: 11,
          hasMore: false
        })
      );

    await expect(
      syncProjectsOnce({
        bridge: local,
        endpoint: "https://api.example.test",
        fetchImpl
      })
    ).resolves.toEqual({ pushed: 1, failed: 0, pulled: 1, cursor: 11 });

    expect(local.acknowledgeOutbox).toHaveBeenCalledWith(operation.operationId);
    expect(local.applyProjectChange).toHaveBeenCalledWith({
      projectId: operation.projectId,
      revision: 3,
      commitSequence: 11,
      deleted: false,
      project: operation.payload
    });
  });

  it("records a retry and does not delete the outbox operation on network failure", async () => {
    const local = bridge();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));

    await expect(
      syncProjectsOnce({
        bridge: local,
        endpoint: "https://api.example.test",
        fetchImpl
      })
    ).resolves.toEqual({ pushed: 0, failed: 1, pulled: 0, cursor: 0 });

    expect(local.recordOutboxFailure).toHaveBeenCalledWith(
      operation.operationId,
      "offline"
    );
    expect(local.acknowledgeOutbox).not.toHaveBeenCalled();
  });
});
