import {
  ProjectDetailView as SharedProjectDetailView,
  ProjectRepositoryError,
  type ProjectDetailViewRenderContext,
  type ProjectRepository
} from "@project-online/ui";
import {
  PROJECT_AUDIT_VALUE_FIELDS,
  type ProjectAuditField,
  type ProjectAuditValueField,
  type ProjectRecord
} from "@project-online/domain";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { ApiClientError } from "../../api-client.js";
import { ProjectMembersPanel } from "./ProjectMembersPanel.js";
import { toProjectUpdateRepositoryError } from "./project-repository-error.js";
import type {
  ProjectAuditView,
  ProjectsClient
} from "./projects-client.js";

export interface ProjectDetailViewProps {
  projectId: string;
  client: ProjectsClient;
  onBack(): void;
  onSessionExpired(): void;
}

type LifecycleAction = "archive" | "restore";
type AuditError = "forbidden" | "failed" | "more-failed" | null;

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

function valueLabel(value: string | number | null): string {
  return value === null || value === "" ? "未填写" : String(value);
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

function mapRepositoryError(
  error: unknown,
  options: {
    forbiddenMessage: string;
    notFoundMessage?: string;
  }
): unknown {
  if (!(error instanceof ApiClientError)) {
    return error;
  }
  if (
    error.status === 401 &&
    (error.code === "SESSION_EXPIRED" ||
      error.code === "AUTHENTICATION_REQUIRED")
  ) {
    return new ProjectRepositoryError("AUTHENTICATION_REQUIRED", "请重新登录", {
      cause: error
    });
  }
  if (error.status === 403) {
    return new ProjectRepositoryError(
      "PROJECT_FORBIDDEN",
      options.forbiddenMessage,
      { cause: error }
    );
  }
  if (error.status === 404) {
    return new ProjectRepositoryError(
      "PROJECT_NOT_FOUND",
      options.notFoundMessage ?? "项目不存在或您无权查看",
      { cause: error }
    );
  }
  return new ProjectRepositoryError("UNAVAILABLE", error.message, {
    cause: error
  });
}

export function ProjectDetailView({
  projectId,
  client,
  onBack,
  onSessionExpired
}: ProjectDetailViewProps) {
  const repository = useMemo<ProjectRepository>(
    () => ({
      listProjects: async (filters) => {
        try {
          const page = await client.listProjects(filters);
          return {
            ...page,
            items: page.items.map(({ owners, ...item }) => ({
              ...item,
              ownerLabels: owners.map(({ displayName }) => displayName)
            }))
          };
        } catch (error) {
          throw mapRepositoryError(error, {
            forbiddenMessage: "您没有查看项目的权限"
          });
        }
      },
      getProject: async (requestedProjectId) => {
        try {
          return await client.getProject(requestedProjectId);
        } catch (error) {
          throw mapRepositoryError(error, {
            forbiddenMessage: "您没有查看此项目的权限"
          });
        }
      },
      updateProject: async (requestedProjectId, input) => {
        try {
          return await client.updateProject(requestedProjectId, input);
        } catch (error) {
          throw toProjectUpdateRepositoryError(error, input);
        }
      }
    }),
    [client]
  );
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
  const lifecycleDialog = useRef<HTMLDivElement>(null);
  const lifecycleTrigger = useRef<HTMLElement | null>(null);
  const lifecycleLocked = useRef(false);
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
    currentProjectId.current = projectId;
    lifecycleLocked.current = false;
    auditLocked.current = false;
    auditRequestId.current += 1;
    auditOpenRef.current = false;
    setLifecycleAction(null);
    setLifecycleSubmitting(false);
    setLifecycleError("");
    setAuditOpen(false);
    setAuditItems([]);
    setAuditPage(0);
    setAuditTotal(0);
    setAuditLoading(false);
    setAuditError(null);
    setMembersBusy(false);
  }, [projectId]);

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

  async function confirmLifecycle(
    context: ProjectDetailViewRenderContext
  ): Promise<void> {
    if (lifecycleAction === null || lifecycleLocked.current) {
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
        context.setDetails(saved);
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
        setLifecycleAction(null);
        context.showError("hidden");
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

  async function handleMembersChanged(
    context: ProjectDetailViewRenderContext
  ): Promise<void> {
    try {
      const loadedDetails = await context.reloadDetails();
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
      await loadAuditPage(1, true);
    } catch (error) {
      if (
        error instanceof ProjectRepositoryError &&
        error.code === "AUTHENTICATION_REQUIRED"
      ) {
        return;
      }
      if (
        error instanceof ProjectRepositoryError &&
        (error.code === "PROJECT_FORBIDDEN" ||
          error.code === "PROJECT_NOT_FOUND")
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
        return;
      }
      throw error;
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

  return (
    <SharedProjectDetailView
      actionSlot={(context) => (
        <>
          {context.details.permissions.canChangeLifecycle ? (
            <button
              className="secondary-button"
              onClick={(event) => {
                lifecycleTrigger.current = event.currentTarget;
                setLifecycleError("");
                setLifecycleAction(
                  context.details.project.lifecycle === "ACTIVE"
                    ? "archive"
                    : "restore"
                );
              }}
              type="button"
            >
              {context.details.project.lifecycle === "ACTIVE"
                ? "归档项目"
                : "恢复项目"}
            </button>
          ) : null}
          {context.details.permissions.canReadAudit ? (
            <button
              className="secondary-button"
              onClick={toggleAudit}
              type="button"
            >
              {auditOpen ? "关闭审计记录" : "查看审计记录"}
            </button>
          ) : null}
        </>
      )}
      backDisabled={membersBusy}
      editorSubmitLabel="保存修改"
      onAuthenticationRequired={onSessionExpired}
      onBack={onBack}
      projectId={projectId}
      repository={repository}
      sectionSlot={(context) => {
        const canLoadMore = auditItems.length < auditTotal;
        const actionLabel = lifecycleAction === "archive" ? "归档" : "恢复";
        return (
          <>
            <section className="project-detail__section">
              <ProjectMembersPanel
                canManageMembers={context.details.permissions.canManageMembers}
                client={client}
                onBusyChange={setMembersBusy}
                onChanged={() => handleMembersChanged(context)}
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

            {lifecycleAction !== null ? (
              <div className="modal-backdrop">
                <div
                  aria-labelledby="project-lifecycle-title"
                  aria-modal="true"
                  className="project-lifecycle-dialog"
                  onKeyDown={handleLifecycleKeyDown}
                  ref={lifecycleDialog}
                  role="alertdialog"
                  tabIndex={-1}
                >
                  <h3 id="project-lifecycle-title">{actionLabel}项目</h3>
                  <p>
                    {lifecycleAction === "archive"
                      ? `确认归档项目“${context.details.project.name}”吗？`
                      : `确认恢复项目“${context.details.project.name}”吗？`}
                  </p>
                  {lifecycleError ? (
                    <p className="form-error" role="alert">
                      {lifecycleError}
                    </p>
                  ) : null}
                  <div className="project-editor-actions">
                    <button
                      className="secondary-button"
                      disabled={lifecycleSubmitting || membersBusy}
                      onClick={() => setLifecycleAction(null)}
                      type="button"
                    >
                      {`取消${actionLabel}`}
                    </button>
                    <button
                      className="primary-button"
                      disabled={lifecycleSubmitting || membersBusy}
                      onClick={() => void confirmLifecycle(context)}
                      type="button"
                    >
                      {lifecycleSubmitting ? `${actionLabel}中` : `确认${actionLabel}`}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        );
      }}
    />
  );
}
