import {
  PROJECT_STATUSES,
  type ProjectLifecycle,
  type ProjectListFilters,
  type ProjectStatus,
  type SystemRole
} from "@project-online/domain";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../api-client.js";
import type { ProjectPage, ProjectsClient } from "./projects-client.js";

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

function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    (error.code === "SESSION_EXPIRED" ||
      error.code === "AUTHENTICATION_REQUIRED")
  );
}

function listError(error: unknown): "forbidden" | "failed" {
  return error instanceof ApiClientError && error.status === 403
    ? "forbidden"
    : "failed";
}

export function ProjectListView({
  client,
  sessionRole,
  onCreateProject,
  onOpenProject,
  onSessionExpired,
  refreshToken = 0
}: ProjectListViewProps) {
  const [filters, setFilters] = useState<ViewFilters>(() =>
    readFilters(window.location.search)
  );
  const [yearInput, setYearInput] = useState(() => {
    const year = readFilters(window.location.search).year;
    return year === undefined ? "" : String(year);
  });
  const [page, setPage] = useState<ProjectPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const restoreFilters = () => {
      const restored = readFilters(window.location.search);
      setLoading(true);
      setError(null);
      setFilters(restored);
      setYearInput(restored.year === undefined ? "" : String(restored.year));
    };
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);

  useEffect(() => {
    let active = true;

    void client
      .listProjects(filters as ProjectListFilters)
      .then((loadedPage) => {
        if (active) {
          setError(null);
          setPage(loadedPage);
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        if (isSessionExpired(loadError)) {
          onSessionExpired();
          return;
        }
        setError(listError(loadError));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, filters, onSessionExpired, refreshToken, retryToken]);

  function updateFilters(
    changes: Partial<Omit<ViewFilters, "pageSize">>,
    resetPage = true
  ): void {
    const nextFilters = {
      ...filters,
      ...changes,
      page: resetPage ? 1 : (changes.page ?? filters.page)
    };
    setLoading(true);
    setError(null);
    setFilters(nextFilters);
    writeFilters(nextFilters);
  }

  const hasFilters =
    filters.query !== "" ||
    filters.year !== undefined ||
    filters.status !== undefined ||
    filters.lifecycle !== undefined;
  const canGoNext = page !== null && filters.page * 20 < page.total;

  return (
    <section className="projects-card" aria-labelledby="projects-title">
      <div className="projects-card__heading">
        <div>
          <h2 id="projects-title">项目</h2>
          <p>查看并筛选当前可访问的项目</p>
        </div>
        {sessionRole === "ADMIN" ? (
          <button
            className="primary-button"
            onClick={onCreateProject}
            type="button"
          >
            新建项目
          </button>
        ) : null}
      </div>

      <div className="project-filters" aria-label="项目筛选">
        <label>
          <span>项目名称关键字</span>
          <input
            onChange={(event) => updateFilters({ query: event.target.value })}
            type="search"
            value={filters.query}
          />
        </label>
        <label>
          <span>年度</span>
          <input
            min="1900"
            max="2100"
            onChange={(event) => {
              setYearInput(event.target.value);
              updateFilters({ year: parseYear(event.target.value) });
            }}
            type="number"
            value={yearInput}
          />
        </label>
        <label>
          <span>状态</span>
          <select
            onChange={(event) =>
              updateFilters({ status: parseStatus(event.target.value) })
            }
            value={filters.status ?? ""}
          >
            <option value="">全部</option>
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>生命周期</span>
          <select
            onChange={(event) =>
              updateFilters({ lifecycle: parseLifecycle(event.target.value) })
            }
            value={filters.lifecycle ?? ""}
          >
            <option value="">全部</option>
            <option value="ACTIVE">进行中</option>
            <option value="ARCHIVED">已归档</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="project-list-state" role="status">
          正在加载项目
        </p>
      ) : null}
      {!loading && error === "forbidden" ? (
        <p className="project-list-state form-error" role="alert">
          您没有查看项目的权限
        </p>
      ) : null}
      {!loading && error === "failed" ? (
        <div className="project-list-state" role="alert">
          <p>项目加载失败，请重试</p>
          <button
            className="secondary-button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setRetryToken((value) => value + 1);
            }}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}
      {!loading && error === null && page?.items.length === 0 ? (
        <p className="project-list-state">
          {hasFilters ? "没有符合筛选条件的项目" : "暂无项目"}
        </p>
      ) : null}
      {!loading && error === null && page !== null && page.items.length > 0 ? (
        <div className="project-table-container">
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">项目名称</th>
                <th scope="col">年度</th>
                <th scope="col">类型</th>
                <th scope="col">状态</th>
                <th scope="col">阶段</th>
                <th scope="col">负责人</th>
                <th scope="col">更新时间</th>
                <th scope="col">生命周期</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(({ project, owners }) => (
                <tr key={project.id}>
                  <td data-label="项目名称">
                    <button
                      className="project-name-button"
                      onClick={() => onOpenProject(project.id)}
                      type="button"
                    >
                      {project.name}
                    </button>
                  </td>
                  <td data-label="年度">{project.year}</td>
                  <td data-label="类型">{project.type || "—"}</td>
                  <td data-label="状态">{project.status}</td>
                  <td data-label="阶段">{project.phase || "—"}</td>
                  <td data-label="负责人">
                    {owners.map(({ displayName }) => displayName).join("、") ||
                      "—"}
                  </td>
                  <td data-label="更新时间">{project.updatedAt}</td>
                  <td data-label="生命周期">
                    {project.lifecycle === "ACTIVE" ? "进行中" : "已归档"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && error === null && page !== null && page.total > 20 ? (
        <div className="project-pagination" aria-label="项目分页">
          <button
            className="secondary-button"
            disabled={filters.page === 1}
            onClick={() => updateFilters({ page: filters.page - 1 }, false)}
            type="button"
          >
            上一页
          </button>
          <span>第 {filters.page} 页</span>
          <button
            className="secondary-button"
            disabled={!canGoNext}
            onClick={() => updateFilters({ page: filters.page + 1 }, false)}
            type="button"
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  );
}
