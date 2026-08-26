import {
  PROTOCOL_VERSION,
  type PullProjectsResponse,
  type PushProjectsResponse,
  type ProjectSyncOperation
} from "@project-online/sync";

import type { PendingOutboxItem } from "../platform/desktop-bridge.js";

export interface SyncBridge {
  pendingOutbox(limit: number): Promise<PendingOutboxItem[]>;
  acknowledgeOutbox(operationId: string): Promise<void>;
  recordOutboxFailure(operationId: string, message: string): Promise<void>;
  getSyncCursor(): Promise<number>;
  advanceSyncCursor(cursor: number): Promise<void>;
  applyProjectChange(input: {
    projectId: string;
    revision: number;
    commitSequence: number;
    deleted: boolean;
    project: Record<string, unknown> | null;
  }): Promise<void>;
}

export interface SyncOnceOptions {
  bridge: SyncBridge;
  endpoint: string;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  pageSize?: number;
}

export interface SyncOnceResult {
  pushed: number;
  failed: number;
  pulled: number;
  cursor: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "同步请求失败";
}

function apiUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/$/, "")}${path}`;
}

function toOperation(item: PendingOutboxItem): ProjectSyncOperation {
  return {
    protocolVersion: 1,
    operationId: item.operationId,
    deviceId: item.deviceId,
    clientSequence: item.clientSequence,
    entityType: "PROJECT",
    entityId: item.entityId,
    projectId: item.projectId,
    action: item.action,
    baseRevision: item.baseRevision,
    payload: JSON.parse(item.payloadJson) as ProjectSyncOperation["payload"]
  };
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`同步请求失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

export async function syncProjectsOnce({
  bridge,
  endpoint,
  fetchImpl = fetch,
  batchSize = 100,
  pageSize = 500
}: SyncOnceOptions): Promise<SyncOnceResult> {
  const pending = await bridge.pendingOutbox(batchSize);
  let pushed = 0;
  let failed = 0;

  if (pending.length > 0) {
    let response: PushProjectsResponse;
    try {
      const operations = pending.map(toOperation);
      response = await readJson<PushProjectsResponse>(
        await fetchImpl(apiUrl(endpoint, "/api/v1/sync/push"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            deviceId: operations[0]!.deviceId,
            operations
          })
        })
      );
    } catch (error) {
      const message = errorMessage(error);
      await Promise.all(
        pending.map((item) =>
          bridge.recordOutboxFailure(item.operationId, message)
        )
      );
      return {
        pushed: 0,
        failed: pending.length,
        pulled: 0,
        cursor: await bridge.getSyncCursor()
      };
    }

    for (const result of response.results) {
      if (result.status === "ACCEPTED" || result.status === "DUPLICATE") {
        await bridge.acknowledgeOutbox(result.operationId);
        pushed += 1;
      } else {
        await bridge.recordOutboxFailure(result.operationId, result.status);
        failed += 1;
      }
    }
  }

  let cursor = await bridge.getSyncCursor();
  let pulled = 0;
  let hasMore = true;
  while (hasMore) {
    let response: PullProjectsResponse;
    try {
      response = await readJson<PullProjectsResponse>(
        await fetchImpl(
          `${apiUrl(endpoint, "/api/v1/sync/pull")}?after=${cursor}&limit=${pageSize}`,
          { credentials: "include" }
        )
      );
    } catch {
      return { pushed, failed: failed + 1, pulled, cursor };
    }

    for (const change of response.changes) {
      if (change.type === "PROJECT") {
        await bridge.applyProjectChange({
          projectId: change.projectId,
          revision: change.revision,
          commitSequence: change.commitSequence,
          deleted: change.deleted,
          project: change.project === null ? null : { ...change.project }
        });
        pulled += 1;
      } else {
        await bridge.applyProjectChange({
          projectId: change.projectId,
          revision: 0,
          commitSequence: change.commitSequence,
          deleted: true,
          project: null
        });
        pulled += 1;
      }
    }
    if (response.changes.length === 0) {
      await bridge.advanceSyncCursor(response.nextCursor);
    }
    cursor = Math.max(cursor, response.nextCursor);
    hasMore = response.hasMore && response.nextCursor > cursor;
  }

  return { pushed, failed, pulled, cursor };
}
