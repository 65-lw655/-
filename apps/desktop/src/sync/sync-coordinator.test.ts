import { describe, expect, it, vi } from "vitest";

import { createSyncCoordinator } from "./sync-coordinator.js";
import type { SyncBridge } from "./sync-client.js";

function bridge(): SyncBridge {
  return {
    pendingOutbox: vi.fn(async () => []),
    acknowledgeOutbox: vi.fn(async () => undefined),
    recordOutboxFailure: vi.fn(async () => undefined),
    getSyncCursor: vi.fn(async () => 0),
    advanceSyncCursor: vi.fn(async () => undefined),
    applyProjectChange: vi.fn(async () => undefined)
  };
}

describe("sync coordinator", () => {
  it("runs one manual sync and exposes its result", async () => {
    const sync = vi.fn(async () => ({
      pushed: 1,
      failed: 0,
      pulled: 2,
      cursor: 4
    }));
    const coordinator = createSyncCoordinator({
      bridge: bridge(),
      endpoint: "https://api.example.test",
      syncOnce: sync
    });

    await expect(coordinator.syncNow()).resolves.toEqual({
      pushed: 1,
      failed: 0,
      pulled: 2,
      cursor: 4
    });
    expect(coordinator.getState()).toEqual({
      phase: "success",
      result: { pushed: 1, failed: 0, pulled: 2, cursor: 4 },
      error: null
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent startup and manual sync requests", async () => {
    let release!: () => void;
    const sync = vi.fn(
      () =>
        new Promise<{
          pushed: number;
          failed: number;
          pulled: number;
          cursor: number;
        }>((resolve) => {
          release = () =>
            resolve({ pushed: 0, failed: 0, pulled: 0, cursor: 0 });
        })
    );
    const coordinator = createSyncCoordinator({
      bridge: bridge(),
      endpoint: "https://api.example.test",
      syncOnce: sync
    });

    const first = coordinator.syncNow();
    const second = coordinator.syncNow();
    expect(sync).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
