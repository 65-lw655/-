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
    discardOutbox: vi.fn(async () => undefined),
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

  it("retries a retryable push result before acknowledging the operation", async () => {
    const local = bridge();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          results: [
            {
              operationId: operation.operationId,
              status: "RETRYABLE",
              entityId: operation.entityId
            }
          ]
        })
      )
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
      .mockResolvedValue(
        response({
          protocolVersion: 1,
          changes: [],
          nextCursor: 10,
          hasMore: false
        })
      );

    await expect(
      syncProjectsOnce({
        bridge: local,
        endpoint: "https://api.example.test",
        fetchImpl,
        retryDelaysMs: [0]
      })
    ).resolves.toMatchObject({ pushed: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(local.acknowledgeOutbox).toHaveBeenCalledWith(operation.operationId);
  });

  it("surfaces invalid sessions without retrying", async () => {
    const local = bridge();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ code: "INVALID_SESSION" }, 401));

    await expect(
      syncProjectsOnce({
        bridge: local,
        endpoint: "https://api.example.test",
        fetchImpl,
        retryDelaysMs: [0]
      })
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(local.acknowledgeOutbox).not.toHaveBeenCalled();
  });

  it("quarantines a permanently forbidden operation instead of retrying it", async () => {
    const local = bridge();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          results: [
            {
              operationId: operation.operationId,
              status: "FORBIDDEN",
              entityId: operation.entityId
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          changes: [],
          nextCursor: 0,
          hasMore: false
        })
      );

    await expect(
      syncProjectsOnce({
        bridge: local,
        endpoint: "https://api.example.test",
        fetchImpl,
        retryDelaysMs: [0]
      })
    ).resolves.toMatchObject({ pushed: 0, failed: 1 });
    expect(local.discardOutbox).toHaveBeenCalledWith(
      operation.operationId,
      operation.projectId,
      "FORBIDDEN"
    );
    expect(local.acknowledgeOutbox).not.toHaveBeenCalled();
  });

  it("continues pulling pages until the server reports no more changes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          changes: [],
          nextCursor: 1,
          hasMore: true
        })
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          changes: [
            {
              type: "PROJECT_ACCESS_REVOKED",
              projectId: operation.projectId,
              commitSequence: 2
            }
          ],
          nextCursor: 2,
          hasMore: false
        })
      );

    await expect(
      syncProjectsOnce({
        bridge: { ...bridge(), pendingOutbox: vi.fn(async () => []) },
        endpoint: "https://api.example.test",
        fetchImpl,
        retryDelaysMs: [0]
      })
    ).resolves.toMatchObject({ pulled: 1, cursor: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
