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
  discardOutbox?(
    operationId: string,
    projectId: string,
    reason: string
  ): Promise<void>;
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
  retryDelaysMs?: readonly number[];
}

export interface SyncOnceResult {
  pushed: number;
  failed: number;
  pulled: number;
  cursor: number;
}

export class SyncClientError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_SESSION" | "HTTP_ERROR"
  ) {
    super(message);
    this.name = "SyncClientError";
  }
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
    let code: string | undefined;
    try {
      const body = (await response.clone().json()) as { code?: unknown };
      code = typeof body.code === "string" ? body.code : undefined;
    } catch {
      code = undefined;
    }
    if (response.status === 401 || code === "INVALID_SESSION") {
      throw new SyncClientError(
        "登录状态已失效，请重新登录",
        "INVALID_SESSION"
      );
    }
    throw new SyncClientError(
      `同步请求失败（HTTP ${response.status}）`,
      "HTTP_ERROR"
    );
  }
  return (await response.json()) as T;
}

const DEFAULT_RETRY_DELAYS_MS = [5000, 15000, 60000, 300000, 1800000] as const;

async function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function syncProjectsOnce({
  bridge,
  endpoint,
  fetchImpl = fetch,
  batchSize = 100,
  pageSize = 500,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS
}: SyncOnceOptions): Promise<SyncOnceResult> {
  const pending = await bridge.pendingOutbox(batchSize);
  let pushed = 0;
  let failed = 0;

  if (pending.length > 0) {
    const operations = pending.map(toOperation);
    let response: PushProjectsResponse | undefined;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
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
        const retryable = response.results.some(
          (result) => result.status === "RETRYABLE"
        );
        if (!retryable || attempt === retryDelaysMs.length) {
          break;
        }
      } catch (error) {
        if (
          error instanceof SyncClientError &&
          error.code === "INVALID_SESSION"
        ) {
          throw error;
        }
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
      await waitForRetry(retryDelaysMs[attempt]!);
    }
    if (!response) {
      throw new Error("同步响应为空");
    }

    for (const result of response.results) {
      if (result.status === "ACCEPTED" || result.status === "DUPLICATE") {
        await bridge.acknowledgeOutbox(result.operationId);
        pushed += 1;
      } else {
        const item = pending.find(
          (candidate) => candidate.operationId === result.operationId
        );
        if (
          item &&
          bridge.discardOutbox &&
          ["FORBIDDEN", "VALIDATION_FAILED", "NOT_FOUND"].includes(
            result.status
          )
        ) {
          await bridge.discardOutbox(
            result.operationId,
            item.projectId,
            result.status
          );
        } else {
          await bridge.recordOutboxFailure(result.operationId, result.status);
        }
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
    const previousCursor = cursor;
    if (response.changes.length === 0) {
      await bridge.advanceSyncCursor(response.nextCursor);
    }
    cursor = Math.max(cursor, response.nextCursor);
    hasMore = response.hasMore && response.nextCursor > previousCursor;
  }

  return { pushed, failed, pulled, cursor };
}
