import type { ProjectListFilters } from "@project-online/domain";
import {
  ProjectDetailView,
  ProjectListView,
  type ProjectRepository
} from "@project-online/ui";
import { useEffect, useMemo, useState } from "react";

import {
  desktopBridge,
  type DesktopBridge,
  type LocalStatus
} from "../platform/desktop-bridge.js";
import { createLocalProjectRepository } from "../repository/local-project-repository.js";
import { SyncStatus } from "../features/sync-status/SyncStatus.js";

type StartupState = "preparing" | "ready" | "blocked";

export interface DesktopAppProps {
  bridge?: DesktopBridge;
}

const initialFilters: ProjectListFilters = {
  page: 1,
  pageSize: 20,
  query: ""
};

export function DesktopApp({ bridge = desktopBridge }: DesktopAppProps) {
  const [startupState, setStartupState] = useState<StartupState>("preparing");
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [filters, setFilters] = useState<ProjectListFilters>(initialFilters);
  const [refreshToken, setRefreshToken] = useState(0);

  const repository: ProjectRepository = useMemo(() => {
    const localRepository = createLocalProjectRepository(bridge);

    return {
      listProjects: localRepository.listProjects,
      getProject: localRepository.getProject,
      updateProject: async (projectId, input) => {
        const updatedDetails = await localRepository.updateProject(
          projectId,
          input
        );
        try {
          const loadedStatus = await bridge.getLocalStatus();
          setStatus(loadedStatus);
        } catch {
          setStatus((current) =>
            current === null
              ? current
              : { ...current, pendingCount: current.pendingCount + 1 }
          );
        }
        setRefreshToken((value) => value + 1);
        return updatedDetails;
      }
    };
  }, [bridge]);

  useEffect(() => {
    let active = true;

    void bridge
      .getLocalStatus()
      .then((loadedStatus) => {
        if (!active) {
          return;
        }
        setStatus(loadedStatus);
        setStartupState("ready");
      })
      .then(() => {
        return undefined;
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setStartupState("blocked");
      });

    return () => {
      active = false;
    };
  }, [bridge]);

  return (
    <main className="desktop-shell">
      <header className="desktop-shell__header">
        <div>
          <h1>本机项目</h1>
          <p>离线查看和编辑本机缓存项目</p>
        </div>
        {status ? <SyncStatus pendingCount={status.pendingCount} /> : null}
      </header>

      {startupState === "preparing" ? (
        <section className="desktop-state" aria-live="polite">
          <p>正在准备本地数据</p>
        </section>
      ) : null}

      {startupState === "blocked" ? (
        <section className="desktop-state desktop-state--blocked" role="alert">
          <h2>本机数据初始化失败</h2>
          <p>请检查本机数据目录权限后重新启动应用。</p>
        </section>
      ) : null}

      {startupState === "ready" && selectedProjectId === null ? (
        <ProjectListView
          filters={filters}
          onFiltersChange={setFilters}
          onOpenProject={setSelectedProjectId}
          refreshToken={refreshToken}
          repository={repository}
        />
      ) : null}

      {startupState === "ready" && selectedProjectId !== null ? (
        <ProjectDetailView
          editorSubmitLabel="保存到本机"
          onBack={() => setSelectedProjectId(null)}
          projectId={selectedProjectId}
          repository={repository}
          sectionSlot={
            <p className="desktop-sync-note">
              本机保存后会写入待同步队列，M4 暂不自动上传。
            </p>
          }
        />
      ) : null}
    </main>
  );
}
