import {
  syncProjectsOnce,
  type SyncBridge,
  type SyncOnceResult
} from "./sync-client.js";

export type SyncPhase = "idle" | "running" | "success" | "error";

export interface SyncCoordinatorState {
  phase: SyncPhase;
  result: SyncOnceResult | null;
  error: Error | null;
}

interface SyncCoordinatorOptions {
  bridge: SyncBridge;
  endpoint: string;
  syncOnce?: typeof syncProjectsOnce;
  onStateChange?: (state: SyncCoordinatorState) => void;
}

export function createSyncCoordinator({
  bridge,
  endpoint,
  syncOnce = syncProjectsOnce,
  onStateChange
}: SyncCoordinatorOptions) {
  let state: SyncCoordinatorState = {
    phase: "idle",
    result: null,
    error: null
  };
  let running: Promise<SyncOnceResult> | null = null;

  const publish = (next: SyncCoordinatorState) => {
    state = next;
    onStateChange?.(state);
  };

  return {
    getState: () => state,
    syncNow: () => {
      if (running !== null) {
        return running;
      }
      publish({ phase: "running", result: null, error: null });
      running = syncOnce({ bridge, endpoint })
        .then((result) => {
          publish({ phase: "success", result, error: null });
          return result;
        })
        .catch((error: unknown) => {
          const normalized =
            error instanceof Error ? error : new Error("同步失败");
          publish({ phase: "error", result: null, error: normalized });
          throw normalized;
        })
        .finally(() => {
          running = null;
        });
      return running;
    }
  };
}
