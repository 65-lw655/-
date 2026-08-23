import type { ProjectRecord } from "@project-online/domain";
import { useEffect, useState, type ReactNode } from "react";

import {
  ProjectRepositoryError,
  type ProjectDetails,
  type ProjectRepository
} from "./repository.js";
import { ProjectEditorDialog } from "./ProjectEditorDialog.js";

export interface ProjectDetailViewProps {
  projectId: string;
  repository: ProjectRepository;
  onBack(): void;
  onAuthenticationRequired?(): void;
  actionSlot?: ProjectDetailViewSlot;
  backDisabled?: boolean;
  sectionSlot?: ProjectDetailViewSlot;
  editorSubmitLabel?: string;
}

export interface ProjectDetailViewRenderContext {
  details: ProjectDetails;
  reloadDetails(): Promise<ProjectDetails>;
  showError(error: "forbidden" | "hidden" | "failed"): void;
  setDetails(details: ProjectDetails): void;
}

type ProjectDetailViewSlot =
  | ReactNode
  | ((context: ProjectDetailViewRenderContext) => ReactNode);

const detailFields: ReadonlyArray<{
  key: keyof Pick<
    ProjectRecord,
    | "name"
    | "year"
    | "type"
    | "status"
    | "phase"
    | "filingStatus"
    | "plannedCompletionDate"
    | "actualCompletionDate"
  >;
  label: string;
}> = [
  { key: "name", label: "项目名称" },
  { key: "year", label: "年度" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" },
  { key: "phase", label: "阶段" },
  { key: "filingStatus", label: "归档状态" },
  { key: "plannedCompletionDate", label: "计划完成日期" },
  { key: "actualCompletionDate", label: "实际完成日期" }
];

function detailError(
  error: unknown
): "authentication" | "forbidden" | "hidden" | "failed" {
  if (!(error instanceof ProjectRepositoryError)) {
    return "failed";
  }
  if (error.code === "AUTHENTICATION_REQUIRED") {
    return "authentication";
  }
  if (error.code === "PROJECT_FORBIDDEN") {
    return "forbidden";
  }
  if (error.code === "PROJECT_NOT_FOUND") {
    return "hidden";
  }
  return "failed";
}

function valueLabel(value: string | number | null): string {
  return value === null || value === "" ? "未填写" : String(value);
}

function lifecycleLabel(lifecycle: ProjectRecord["lifecycle"]): string {
  return lifecycle === "ACTIVE" ? "启用中" : "已归档";
}

export function ProjectDetailView({
  projectId,
  repository,
  onBack,
  onAuthenticationRequired,
  actionSlot,
  backDisabled = false,
  sectionSlot,
  editorSubmitLabel
}: ProjectDetailViewProps) {
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"forbidden" | "hidden" | "failed" | null>(
    null
  );
  const [retryToken, setRetryToken] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);

  async function reloadDetails(): Promise<ProjectDetails> {
    try {
      const loadedDetails = await repository.getProject(projectId);
      setDetails(loadedDetails);
      setError(null);
      return loadedDetails;
    } catch (loadError) {
      const nextError = detailError(loadError);
      if (nextError === "authentication") {
        onAuthenticationRequired?.();
      } else if (nextError === "forbidden" || nextError === "hidden") {
        setDetails(null);
        setError(nextError);
      }
      throw loadError;
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetails(null);
    setError(null);

    void repository
      .getProject(projectId)
      .then((loadedDetails) => {
        if (active) {
          setDetails(loadedDetails);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const nextError = detailError(loadError);
        if (nextError === "authentication") {
          onAuthenticationRequired?.();
          return;
        }
        setError(nextError === "hidden" ? "hidden" : nextError);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [onAuthenticationRequired, projectId, repository, retryToken]);

  if (loading) {
    return (
      <section className="projects-card project-detail">
        <p className="project-list-state" role="status">
          正在加载项目详情
        </p>
      </section>
    );
  }

  if (error !== null || details === null) {
    const message =
      error === "forbidden"
        ? "您没有查看此项目的权限"
        : error === "hidden"
          ? "项目不存在或您无权查看"
          : "项目详情加载失败，请重试";
    return (
      <section className="projects-card project-detail">
        <button
          className="secondary-button"
          disabled={backDisabled}
          onClick={onBack}
          type="button"
        >
          返回项目列表
        </button>
        <div className="project-list-state" role="alert">
          <p>{message}</p>
          {error === "failed" ? (
            <button
              className="secondary-button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setRetryToken((value) => value + 1);
              }}
              type="button"
            >
              重试加载项目
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const { permissions, project, syncState } = details;
  const context: ProjectDetailViewRenderContext = {
    details,
    reloadDetails,
    showError: (nextError) => {
      setDetails(null);
      setError(nextError);
    },
    setDetails
  };

  return (
    <section className="projects-card project-detail">
      <div className="project-detail__back">
        <button
          className="secondary-button"
          disabled={backDisabled}
          onClick={onBack}
          type="button"
        >
          返回项目列表
        </button>
      </div>
      <div className="projects-card__heading project-detail__heading">
        <div>
          <h2>{project.name}</h2>
          <p>查看项目资料{syncState === "PENDING" ? "与本地待同步状态" : ""}</p>
        </div>
        <div className="project-detail__actions">
          {permissions.canEdit ? (
            <button
              className="secondary-button"
              onClick={() => setEditorOpen(true)}
              type="button"
            >
              编辑项目
            </button>
          ) : null}
          {typeof actionSlot === "function" ? actionSlot(context) : actionSlot}
        </div>
      </div>

      <dl aria-label="项目基础信息" className="project-detail__fields">
        {detailFields.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{valueLabel(project[key])}</dd>
          </div>
        ))}
        <div>
          <dt>生命周期</dt>
          <dd>{lifecycleLabel(project.lifecycle)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>
            <time dateTime={project.updatedAt}>{project.updatedAt}</time>
          </dd>
        </div>
      </dl>

      {typeof sectionSlot === "function" ? sectionSlot(context) : sectionSlot}

      {editorOpen ? (
        <ProjectEditorDialog
          details={details}
          onAuthenticationRequired={onAuthenticationRequired}
          onClose={() => setEditorOpen(false)}
          onSaved={(savedDetails) => {
            setDetails(savedDetails);
            setEditorOpen(false);
          }}
          repository={repository}
          submitLabel={editorSubmitLabel}
        />
      ) : null}
    </section>
  );
}
