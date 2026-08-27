export interface SyncStatusProps {
  pendingCount: number;
  phase?: "idle" | "running" | "success" | "error";
  errorMessage?: string | null;
  onSyncNow?: () => void;
}

export function SyncStatus({
  pendingCount,
  phase = "idle",
  errorMessage = null,
  onSyncNow
}: SyncStatusProps) {
  const statusText =
    pendingCount === 0 ? "本机数据已就绪" : `${pendingCount} 项修改待同步`;

  return (
    <aside className="sync-status" aria-label="同步状态">
      <strong>{statusText}</strong>
      <span>
        {phase === "running"
          ? "正在同步"
          : phase === "error"
            ? errorMessage === "登录状态已失效，请重新登录"
              ? "登录已失效，请重新登录"
              : "同步失败，待下次重试"
            : phase === "success"
              ? "同步完成"
              : "同步已就绪"}
      </span>
      {onSyncNow ? (
        <button
          type="button"
          onClick={onSyncNow}
          disabled={phase === "running"}
        >
          立即同步
        </button>
      ) : null}
    </aside>
  );
}
