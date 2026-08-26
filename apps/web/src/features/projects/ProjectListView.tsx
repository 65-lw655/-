import {
  ProjectListView as SharedProjectListView,
  type ProjectRepository
} from "@project-online/ui";
import {
  PROJECT_STATUSES,
  type ProjectLifecycle,
  type ProjectStatus,
  type SystemRole
} from "@project-online/domain";
import { useEffect, useMemo, useState } from "react";

import type { ProjectsClient } from "./projects-client.js";
import { createOnlineProjectRepository } from "./online-project-repository.js";

interface ViewFilters {
  query: string;
  year?: number;
  status?: ProjectStatus;
  lifecycle?: ProjectLifecycle;
  page: number;
  pageSize: 20;
}

export interface ProjectListViewProps {
  client: ProjectsClient;
  repository?: ProjectRepository;
  sessionRole: SystemRole;
  onCreateProject?(): void;
  onOpenProject(projectId: string): void;
  onSessionExpired(): void;
  refreshToken?: number;
}

const LIFECYCLES = ["ACTIVE", "ARCHIVED"] as const;

function parseYear(value: string | null): number | undefined {
  if (value === null || !/^\d{4}$/u.test(value)) {
    return undefined;
  }

  const year = Number(value);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function parseStatus(value: string | null): ProjectStatus | undefined {
  return PROJECT_STATUSES.find((status) => status === value);
}

function parseLifecycle(value: string | null): ProjectLifecycle | undefined {
  return LIFECYCLES.find((lifecycle) => lifecycle === value);
}

function parsePage(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/u.test(value)) {
    return 1;
  }

  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function readFilters(search: string): ViewFilters {
  const params = new URLSearchParams(search);
  return {
    query: params.get("query") ?? "",
    year: parseYear(params.get("year")),
    status: parseStatus(params.get("status")),
    lifecycle: parseLifecycle(params.get("lifecycle")),
    page: parsePage(params.get("page")),
    pageSize: 20
  };
}

function writeFilters(filters: ViewFilters): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("pageSize");
  const values: Array<[string, string | undefined]> = [
    ["query", filters.query || undefined],
    ["year", filters.year === undefined ? undefined : String(filters.year)],
    ["status", filters.status],
    ["lifecycle", filters.lifecycle],
    ["page", filters.page === 1 ? undefined : String(filters.page)]
  ];

  for (const [name, value] of values) {
    if (value === undefined) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }

  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

export function ProjectListView({
  client,
  repository,
  sessionRole,
  onCreateProject,
  onOpenProject,
  onSessionExpired,
  refreshToken = 0
}: ProjectListViewProps) {
  const [filters, setFilters] = useState<ViewFilters>(() =>
    readFilters(window.location.search)
  );
  const projectRepository = useMemo(
    () => repository ?? createOnlineProjectRepository(client),
    [client, repository]
  );

  useEffect(() => {
    const restoreFilters = () => {
      setFilters(readFilters(window.location.search));
    };

    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);

  return (
    <SharedProjectListView
      filters={filters}
      headingAction={
        sessionRole === "ADMIN" ? (
          <button
            className="primary-button"
            onClick={onCreateProject}
            type="button"
          >
            新建项目
          </button>
        ) : null
      }
      onAuthenticationRequired={onSessionExpired}
      onFiltersChange={(nextFilters) => {
        setFilters(nextFilters as ViewFilters);
        writeFilters(nextFilters as ViewFilters);
      }}
      onOpenProject={onOpenProject}
      refreshToken={refreshToken}
      repository={projectRepository}
    />
  );
}
