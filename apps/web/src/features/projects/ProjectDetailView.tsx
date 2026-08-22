import {
  PROJECT_AUDIT_VALUE_FIELDS,
  type ProjectAuditField,
  type ProjectAuditValueField,
  type ProjectRecord
} from "@project-online/domain";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ApiClientError } from "../../api-client.js";
import { ProjectEditorDialog } from "./ProjectEditorDialog.js";
import { ProjectMembersPanel } from "./ProjectMembersPanel.js";
import type {
  ProjectAuditView,
  ProjectDetails,
  ProjectsClient
} from "./projects-client.js";

export interface ProjectDetailViewProps {
  projectId: string;
  client: ProjectsClient;
  onBack(): void;
  onSessionExpired(): void;
}

type DetailError = "forbidden" | "hidden" | "failed" | null;
type LifecycleAction = "archive" | "restore";
type AuditError = "forbidden" | "failed" | "more-failed" | null;

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

const auditFieldLabels: Readonly<Record<ProjectAuditField, string>> = {
  name: "项目名称",
  year: "年度",
  type: "类型",
  status: "状态",
  phase: "阶段",
  filingStatus: "归档状态",
  plannedCompletionDate: "计划完成日期",
  actualCompletionDate: "实际完成日期",
  lifecycle: "生命周期",
  memberRole: "项目角色",
  jobTitle: "职位",
  phone: "电话",
  remark: "备注"
};

const auditValueFields = new Set<ProjectAuditField>(PROJECT_AUDIT_VALUE_FIELDS);

function isAuditValueField(
  field: ProjectAuditField
): field is ProjectAuditValueField {
  return auditValueFields.has(field);
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function detailError(error: unknown): DetailError {
  if (error instanceof ApiClientError && error.status === 403) {
    return "forbidden";
  }
  if (error instanceof ApiClientError && error.status === 404) {
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

function actorLabel(item: ProjectAuditView): string {
  const displayName = item.actor?.displayName.trim();
  if (displayName) {
    return displayName;
  }
  const username = item.actor?.username.trim();
  return username || "未知用户";
}

function auditSummary(item: ProjectAuditView): string[] {
  return item.event.changeSummary.fields.map((field) => {
    const label = `${auditFieldLabels[field]}（${field}）`;
    if (!isAuditValueField(field)) {
      return `${label}：字段已变更`;
    }
    const before = valueLabel(item.event.changeSummary.before?.[field] ?? null);
    const after = valueLabel(item.event.changeSummary.after?.[field] ?? null);
    return `${label}：${before} → ${after}`;
  });
}

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function ProjectDetailView({
  projectId,
  ...props
}: ProjectDetailViewProps) {
  return (
    <ProjectDetailContent key={projectId} projectId={projectId} {...props} />
  );
}

function ProjectDetailContent({
  projectId,
  client,
  onBack,
  onSessionExpired
}: ProjectDetailViewProps) {
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DetailError>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] =
    useState<LifecycleAction | null>(null);
  const [lifecycleSubmitting, setLifecycleSubmitting] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<ProjectAuditView[]>([]);
  const [auditPage, setAuditPage] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<AuditError>(null);
  const [membersBusy, setMembersBusy] = useState(false);
  const detailRequestId = useRef(0);
  const lifecycleLocked = useRef(false);
  const lifecycleDialog = useRef<HTMLDivElement>(null);
  const lifecycleTrigger = useRef<HTMLElement | null>(null);
  const auditLocked = useRef(false);
  const auditRequestId = useRef(0);
  const auditOpenRef = useRef(false);
  const currentProjectId = useRef(projectId);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (lifecycleAction === null) {
      return;
    }

    lifecycleDialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (lifecycleTrigger.current?.isConnected) {
        lifecycleTrigger.current.focus();
      }
    };
  }, [lifecycleAction]);

  useEffect(() => {
    if (lifecycleSubmitting) {
      lifecycleDialog.current?.focus();
    }
  }, [lifecycleSubmitting]);

  useEffect(() => {
    currentProjectId.current = projectId;
    const requestId = ++detailRequestId.current;
    auditRequestId.current += 1;
    lifecycleLocked.current = false;
    auditLocked.current = false;

    void client
      .getProject(projectId)
      .then((loadedDetails) => {
        if (mounted.current && detailRequestId.current === requestId) {
          setDetails(loadedDetails);
        }
      })
      .catch((loadError: unknown) => {
        if (!mounted.current || detailRequestId.current !== requestId) {
          return;
        }
        if (isSessionExpired(loadError)) {
          onSessionExpired();
          return;
        }
        setError(detailError(loadError));
      })
      .finally(() => {
        if (mounted.current && detailRequestId.current === requestId) {
          setLoading(false);
        }
      });
  }, [client, onSessionExpired, projectId, retryToken]);

  async function confirmLifecycle(): Promise<void> {
    if (
      details === null ||
      lifecycleAction === null ||
      lifecycleLocked.current
    ) {
      return;
    }

    const requestedProjectId = projectId;
    const requestedAction = lifecycleAction;
    lifecycleLocked.current = true;
    setLifecycleSubmitting(true);
    setLifecycleError("");

    try {
      const saved =
        requestedAction === "archive"
          ? await client.archiveProject(requestedProjectId)
          : await client.restoreProject(requestedProjectId);
      if (mounted.current && currentProjectId.current === requestedProjectId) {
        setDetails(saved);
        setLifecycleAction(null);
      }
    } catch (mutationError) {
      if (!mounted.current || currentProjectId.current !== requestedProjectId) {
        return;
      }
      if (isSessionExpired(mutationError)) {
        onSessionExpired();
      } else if (
        mutationError instanceof ApiClientError &&
        mutationError.status === 404
      ) {
        setDetails(null);
        setError("hidden");
        setLifecycleAction(null);
      } else if (
        mutationError instanceof ApiClientError &&
        mutationError.status === 403
      ) {
        setLifecycleError("您没有变更项目生命周期的权限");
      } else if (
        mutationError instanceof ApiClientError &&
        mutationError.status === 409
      ) {
        setLifecycleError("项目状态已变化，请重试");
      } else {
        setLifecycleError("项目生命周期变更失败，请重试");
      }
    } finally {
      if (mounted.current && currentProjectId.current === requestedProjectId) {
        lifecycleLocked.current = false;
        setLifecycleSubmitting(false);
      }
    }
  }

  async function loadAuditPage(
    page: number,
    replace: boolean
  ): Promise<boolean> {
    if (auditLocked.current) {
      return false;
    }

    const requestedProjectId = projectId;
    const requestId = ++auditRequestId.current;
    auditLocked.current = true;
    setAuditLoading(true);
    setAuditError(null);

    try {
      const loadedPage = await client.listAuditEvents(requestedProjectId, page);
      if (
        !mounted.current ||
        currentProjectId.current !== requestedProjectId ||
        auditRequestId.current !== requestId
      ) {
        return false;
      }
      setAuditItems((current) =>
        replace ? loadedPage.items : [...current, ...loadedPage.items]
      );
      setAuditPage(loadedPage.page);
      setAuditTotal(loadedPage.total);
      return true;
    } catch (loadError) {
      if (
        !mounted.current ||
        currentProjectId.current !== requestedProjectId ||
        auditRequestId.current !== requestId
      ) {
        return false;
      }
      if (isSessionExpired(loadError)) {
        onSessionExpired();
      } else if (
        loadError instanceof ApiClientError &&
        loadError.status === 403
      ) {
        setAuditError("forbidden");
      } else {
        setAuditError(replace ? "failed" : "more-failed");
      }
      return false;
    } finally {
      if (
        mounted.current &&
        currentProjectId.current === requestedProjectId &&
        auditRequestId.current === requestId
      ) {
        auditLocked.current = false;
        setAuditLoading(false);
      }
    }
  }

  function toggleAudit(): void {
    if (auditOpen) {
      auditOpenRef.current = false;
      auditRequestId.current += 1;
      auditLocked.current = false;
      setAuditOpen(false);
      setAuditItems([]);
      setAuditPage(0);
      setAuditTotal(0);
      setAuditLoading(false);
      setAuditError(null);
      return;
    }

    auditOpenRef.current = true;
    setAuditOpen(true);
    setAuditItems([]);
    setAuditPage(0);
    setAuditTotal(0);
    void loadAuditPage(1, true);
  }

  async function handleMembersChanged(): Promise<void> {
    const requestedProjectId = projectId;
    const requestId = ++detailRequestId.current;

    let loadedDetails: ProjectDetails;
    try {
      loadedDetails = await client.getProject(requestedProjectId);
    } catch (loadError) {
      if (
        mounted.current &&
        currentProjectId.current === requestedProjectId &&
        detailRequestId.current === requestId
      ) {
        if (isSessionExpired(loadError)) {
          onSessionExpired();
        } else if (
          loadError instanceof ApiClientError &&
          (loadError.status === 403 || loadError.status === 404)
        ) {
          auditOpenRef.current = false;
          auditRequestId.current += 1;
          auditLocked.current = false;
          setAuditOpen(false);
          setAuditItems([]);
          setAuditPage(0);
          setAuditTotal(0);
          setAuditLoading(false);
          setAuditError(null);
          setDetails(null);
          setError(detailError(loadError));
        }
      }
      throw loadError;
    }

    if (
      !mounted.current ||
      currentProjectId.current !== requestedProjectId ||
      detailRequestId.current !== requestId
    ) {
      return;
    }
    setDetails(loadedDetails);
    setError(null);

    if (!auditOpenRef.current) {
      return;
    }
    if (!loadedDetails.permissions.canReadAudit) {
      auditOpenRef.current = false;
      auditRequestId.current += 1;
      auditLocked.current = false;
      setAuditOpen(false);
      setAuditItems([]);
      setAuditPage(0);
      setAuditTotal(0);
      setAuditLoading(false);
      setAuditError(null);
      return;
    }

    auditRequestId.current += 1;
    auditLocked.current = false;
    setAuditLoading(false);
    const refreshed = await loadAuditPage(1, true);
    if (!refreshed) {
      throw new Error("Project audit refresh failed");
    }
  }

  function handleLifecycleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      if (!lifecycleSubmitting) {
        event.preventDefault();
        setLifecycleAction(null);
      }
      return;
    }
    if (event.key !== "Tab" || lifecycleDialog.current === null) {
      return;
    }

    const controls = focusableControls(lifecycleDialog.current);
    const firstControl = controls[0];
    const lastControl = controls.at(-1);
    if (firstControl === undefined || lastControl === undefined) {
      event.preventDefault();
      lifecycleDialog.current.focus();
      return;
    }
    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === firstControl ||
        !lifecycleDialog.current.contains(activeElement))
    ) {
      event.preventDefault();
      lastControl.focus();
    } else if (!event.shiftKey && activeElement === lastControl) {
      event.preventDefault();
      firstControl.focus();
    }
  }

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
          disabled={membersBusy}
          onClick={onBack}
          type="button"
        >
          返回项目列表
        </button>
        <div className="project-list-state" role="alert">
          <p>{message}</p>
          {error === "failed" || error === null ? (
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

  const { permissions, project } = details;
  const canLoadMore = auditItems.length < auditTotal;
  const actionLabel = lifecycleAction === "archive" ? "归档" : "恢复";

  return (
    <section className="projects-card project-detail">
      <div className="project-detail__back">
        <button
          className="secondary-button"
          disabled={membersBusy}
          onClick={onBack}
          type="button"
        >
          返回项目列表
        </button>
      </div>
      <div className="projects-card__heading project-detail__heading">
        <div>
          <h2>{project.name}</h2>
          <p>查看项目资料、生命周期与审计记录</p>
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
          {permissions.canChangeLifecycle ? (
            <button
              className="secondary-button"
              onClick={(event) => {
                lifecycleTrigger.current = event.currentTarget;
                setLifecycleError("");
                setLifecycleAction(
                  project.lifecycle === "ACTIVE" ? "archive" : "restore"
                );
              }}
              type="button"
            >
              {project.lifecycle === "ACTIVE" ? "归档项目" : "恢复项目"}
            </button>
          ) : null}
          {permissions.canReadAudit ? (
            <button
              className="secondary-button"
              onClick={toggleAudit}
              type="button"
            >
              {auditOpen ? "关闭审计记录" : "查看审计记录"}
            </button>
          ) : null}
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

      <section className="project-detail__section">
        <ProjectMembersPanel
          canManageMembers={permissions.canManageMembers}
          client={client}
          onBusyChange={setMembersBusy}
          onChanged={handleMembersChanged}
          onSessionExpired={onSessionExpired}
          projectId={projectId}
        />
      </section>

      {auditOpen ? (
        <section
          className="project-detail__section"
          aria-labelledby="audit-title"
        >
          <h3 id="audit-title">审计记录</h3>
          {auditLoading && auditItems.length === 0 ? (
            <p role="status">正在加载审计记录</p>
          ) : null}
          {auditError === "forbidden" ? (
            <div className="project-detail__audit-state" role="alert">
              <p>您没有查看审计记录的权限</p>
              <button
                className="secondary-button"
                onClick={() => void loadAuditPage(1, true)}
                type="button"
              >
                重试加载审计记录
              </button>
            </div>
          ) : null}
          {auditError === "failed" ? (
            <div className="project-detail__audit-state" role="alert">
              <p>审计记录加载失败，请重试</p>
              <button
                className="secondary-button"
                onClick={() => void loadAuditPage(1, true)}
                type="button"
              >
                重试加载审计记录
              </button>
            </div>
          ) : null}
          {auditItems.length > 0 ? (
            <ol className="project-audit-list">
              {auditItems.map((item) => (
                <li key={item.event.id}>
                  <div className="project-audit-list__heading">
                    <strong>{item.event.eventType}</strong>
                    <span>提交序号 {item.event.commitSequence}</span>
                  </div>
                  <p>
                    操作人：{actorLabel(item)} · 发生时间：
                    <time dateTime={item.event.occurredAt}>
                      {item.event.occurredAt}
                    </time>
                  </p>
                  <ul>
                    {auditSummary(item).map((summary) => (
                      <li key={summary}>{summary}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : null}
          {!auditLoading && auditError === null && auditItems.length === 0 ? (
            <p>暂无审计记录</p>
          ) : null}
          {auditError === "more-failed" ? (
            <div className="project-detail__audit-state" role="alert">
              <p>更多审计记录加载失败，请重试</p>
              <button
                className="secondary-button"
                onClick={() => void loadAuditPage(auditPage + 1, false)}
                type="button"
              >
                重新加载更多
              </button>
            </div>
          ) : null}
          {canLoadMore && auditError !== "more-failed" ? (
            <button
              className="secondary-button"
              disabled={auditLoading}
              onClick={() => void loadAuditPage(auditPage + 1, false)}
              type="button"
            >
              {auditLoading ? "加载中" : "加载更多"}
            </button>
          ) : null}
        </section>
      ) : null}

      {editorOpen ? (
        <ProjectEditorDialog
          client={client}
          mode="edit"
          onClose={() => setEditorOpen(false)}
          onSaved={setDetails}
          onSessionExpired={onSessionExpired}
          project={project}
        />
      ) : null}

      {lifecycleAction !== null ? (
        <div className="modal-backdrop">
          <div
            aria-describedby={
              lifecycleError
                ? "lifecycle-confirm-description lifecycle-confirm-error"
                : "lifecycle-confirm-description"
            }
            aria-labelledby="lifecycle-confirm-title"
            aria-modal="true"
            className="project-lifecycle-dialog"
            onKeyDown={handleLifecycleKeyDown}
            ref={lifecycleDialog}
            role="alertdialog"
            tabIndex={-1}
          >
            <h3 id="lifecycle-confirm-title">确认{actionLabel}项目</h3>
            <p id="lifecycle-confirm-description">
              确认要{actionLabel}“{project.name}”吗？
            </p>
            {lifecycleError ? (
              <p
                className="form-error project-lifecycle-dialog__error"
                id="lifecycle-confirm-error"
                role="alert"
              >
                {lifecycleError}
              </p>
            ) : null}
            <div className="project-editor-actions">
              <button
                className="secondary-button"
                disabled={lifecycleSubmitting}
                onClick={() => setLifecycleAction(null)}
                type="button"
              >
                取消{actionLabel}
              </button>
              <button
                className="primary-button"
                disabled={lifecycleSubmitting}
                onClick={() => void confirmLifecycle()}
                type="button"
              >
                {lifecycleSubmitting
                  ? `${actionLabel}中`
                  : `确认${actionLabel}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
