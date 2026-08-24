export interface SyncStatusProps {
  pendingCount: number;
}

export function SyncStatus({ pendingCount }: SyncStatusProps) {
  const statusText =
    pendingCount === 0 ? "本机数据已就绪" : `${pendingCount} 项修改待同步`;

  return (
    <aside className="sync-status" aria-label="同步状态">
      <strong>{statusText}</strong>
      <span>M4 暂不自动上传</span>
    </aside>
  );
}
