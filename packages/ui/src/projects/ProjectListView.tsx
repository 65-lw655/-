import {
  PROJECT_STATUSES,
  type ProjectLifecycle,
  type ProjectListFilters,
  type ProjectStatus
} from "@project-online/domain";
import { useEffect, useState, type ReactNode } from "react";

import {
  ProjectRepositoryError,
  type ProjectPage,
  type ProjectRepository
} from "./repository.js";

export interface ProjectListViewProps {
  repository: ProjectRepository;
  filters: ProjectListFilters;
  onFiltersChange(filters: ProjectListFilters): void;
  onOpenProject(projectId: string): void;
  onAuthenticationRequired?(): void;
  headingAction?: ReactNode;
  refreshToken?: number;
}

const LIFECYCLES = ["ACTIVE", "ARCHIVED"] as const;

function parseYear(value: string): number | undefined {
  if (!/^\d{4}$/u.test(value)) {
    return undefined;
  }

  const year = Number(value);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function parseStatus(value: string): ProjectStatus | undefined {
  return PROJECT_STATUSES.find((status) => status === value);
}

function parseLifecycle(value: string): ProjectLifecycle | undefined {
  return LIFECYCLES.find((lifecycle) => lifecycle === value);
}

function listError(error: unknown): "authentication" | "forbidden" | "failed" {
  if (!(error instanceof ProjectRepositoryError)) {
    return "failed";
  }
  if (error.code === "AUTHENTICATION_REQUIRED") {
    return "authentication";
  }
  if (error.code === "PROJECT_FORBIDDEN") {
    return "forbidden";
  }
  return "failed";
}

export function ProjectListView({
  repository,
  filters,
  onFiltersChange,
  onOpenProject,
  onAuthenticationRequired,
  headingAction,
  refreshToken = 0
}: ProjectListViewProps) {
  const [yearInput, setYearInput] = useState(
    filters.year === undefined ? "" : String(filters.year)
  );
  const [page, setPage] = useState<ProjectPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setYearInput(filters.year === undefined ? "" : String(filters.year));
  }, [filters.year]);

  useEffect(() => {
    let active = true;

    void repository
      .listProjects(filters)
      .then((loadedPage) => {
        if (active) {
          setPage(loadedPage);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        if (listError(loadError) === "authentication") {
          onAuthenticationRequired?.();
          return;
        }
        setError(listError(loadError) === "forbidden" ? "forbidden" : "failed");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filters, onAuthenticationRequired, refreshToken, repository, retryToken]);

  function updateFilters(
    changes: Partial<Omit<ProjectListFilters, "pageSize">>,
    resetPage = true
  ): void {
    setLoading(true);
    setError(null);
    onFiltersChange({
      ...filters,
      ...changes,
      page: resetPage ? 1 : (changes.page ?? filters.page),
      pageSize: filters.pageSize
    });
  }

  const hasFilters =
    filters.query !== "" ||
    filters.year !== undefined ||
    filters.status !== undefined ||
    filters.lifecycle !== undefined;
  const canGoNext =
    page !== null && filters.page * filters.pageSize < page.total;

  return (
    <section className="projects-card" aria-labelledby="projects-title">
      <div className="projects-card__heading">
        <div>
          <h2 id="projects-title">项目</h2>
          <p>查看并筛选当前可访问的项目</p>
        </div>
        {headingAction}
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
            max="2100"
            min="1900"
            inputMode="numeric"
            onChange={(event) => {
              const nextValue = event.target.value;
              setYearInput(nextValue);
              updateFilters({ year: parseYear(nextValue) });
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
              {page.items.map(({ project, ownerLabels, syncState }) => (
                <tr key={project.id}>
                  <td data-label="项目名称">
                    <button
                      className="project-name-button"
                      onClick={() => onOpenProject(project.id)}
                      type="button"
                    >
                      {project.name}
                    </button>
                    {syncState === "PENDING" ? (
                      <span className="project-sync-badge">待同步</span>
                    ) : null}
                  </td>
                  <td data-label="年度">{project.year}</td>
                  <td data-label="类型">{project.type || "—"}</td>
                  <td data-label="状态">{project.status}</td>
                  <td data-label="阶段">{project.phase || "—"}</td>
                  <td data-label="负责人">{ownerLabels.join("、") || "—"}</td>
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

      {!loading &&
      error === null &&
      page !== null &&
      page.total > filters.pageSize ? (
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
