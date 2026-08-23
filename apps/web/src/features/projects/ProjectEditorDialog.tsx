import {
  ProjectEditorDialog as SharedProjectEditorDialog,
  type ProjectRepository,
  ProjectRepositoryError
} from "@project-online/ui";
import {
  PROJECT_STATUSES,
  validateProjectInput,
  type ProjectInput,
  type ProjectRecord,
  type ProjectStatus
} from "@project-online/domain";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";

import { ApiClientError } from "../../api-client.js";
import type {
  MemberCandidate,
  ProjectDetails,
  ProjectsClient
} from "./projects-client.js";
import { createOnlineProjectRepository } from "./online-project-repository.js";

interface SharedProps {
  client: ProjectsClient;
  repository?: ProjectRepository;
  onClose(): void;
  onSaved(details: ProjectDetails): void;
  onSessionExpired(): void;
}

type ProjectEditorDialogProps = SharedProps &
  (
    | { mode: "create"; project?: never }
    | { mode: "edit"; project: ProjectRecord }
  );

interface ProjectFormState {
  name: string;
  year: string;
  type: string;
  status: ProjectStatus;
  phase: string;
  filingStatus: string;
  plannedCompletionDate: string;
  actualCompletionDate: string;
}

function initialForm(): ProjectFormState {
  return {
    name: "",
    year: "",
    type: "",
    status: PROJECT_STATUSES[0],
    phase: "",
    filingStatus: "",
    plannedCompletionDate: "",
    actualCompletionDate: ""
  };
}

function toProjectInput(form: ProjectFormState): ProjectInput {
  return {
    name: form.name,
    year: Number(form.year),
    type: form.type,
    status: form.status,
    phase: form.phase,
    filingStatus: form.filingStatus,
    plannedCompletionDate: form.plannedCompletionDate || null,
    actualCompletionDate: form.actualCompletionDate || null
  };
}

function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    (error.code === "SESSION_EXPIRED" ||
      error.code === "AUTHENTICATION_REQUIRED")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "您没有编辑项目的权限";
  }

  return error instanceof ApiClientError
    ? error.message
    : "项目保存失败，请重试";
}

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function ProjectEditorDialog(props: ProjectEditorDialogProps) {
  const repository = useMemo(
    () => props.repository ?? createOnlineProjectRepository(props.client),
    [props.client, props.repository]
  );

  if (props.mode === "edit") {
    return (
      <SharedProjectEditorDialog
        details={{
          project: props.project,
          permissions: {
            canEdit: true,
            canManageMembers: false,
            canChangeLifecycle: false,
            canReadAudit: false
          }
        }}
        onAuthenticationRequired={props.onSessionExpired}
        onClose={props.onClose}
        onSaved={props.onSaved}
        repository={repository}
        submitLabel="保存修改"
      />
    );
  }

  return <CreateProjectEditorDialog {...props} />;
}

function CreateProjectEditorDialog({
  client,
  onClose,
  onSaved,
  onSessionExpired
}: SharedProps) {
  const [form, setForm] = useState<ProjectFormState>(initialForm);
  const [owners, setOwners] = useState<MemberCandidate[]>([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ownersRequest = useRef<Promise<MemberCandidate[]> | null>(null);
  const mounted = useRef(false);
  const submissionRequest = useRef(0);
  const submissionLocked = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current ??= document.activeElement;
    }
    focusableControls(dialogRef.current!)[0]?.focus();

    return () => {
      mounted.current = false;
      submissionRequest.current += 1;
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    ownersRequest.current ??= client.listInitialOwnerCandidates();

    let active = true;
    void ownersRequest.current
      .then((candidates) => {
        if (active) {
          setOwners(candidates);
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
        setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) {
          setLoadingOwners(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, onSessionExpired]);

  function updateField<Key extends keyof ProjectFormState>(
    key: Key,
    value: ProjectFormState[Key]
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (submissionLocked.current) {
      return;
    }

    const input = toProjectInput(form);
    const validation = validateProjectInput(input);
    if (!validation.ok) {
      setFieldErrors(validation.fields);
      setError("");
      return;
    }

    if (ownerUserId === "") {
      setFieldErrors({ ownerUserId: "请选择首位负责人" });
      setError("");
      return;
    }

    submissionLocked.current = true;
    const requestId = ++submissionRequest.current;
    setIsSubmitting(true);
    setFieldErrors({});
    setError("");

    try {
      const saved = await client.createProject({ project: input, ownerUserId });
      if (!mounted.current || submissionRequest.current !== requestId) {
        return;
      }
      onSaved(saved);
      if (mounted.current && submissionRequest.current === requestId) {
        onClose();
      }
    } catch (saveError) {
      if (!mounted.current || submissionRequest.current !== requestId) {
        return;
      }
      if (isSessionExpired(saveError)) {
        onSessionExpired();
      } else {
        setError(errorMessage(saveError));
      }
    } finally {
      if (mounted.current && submissionRequest.current === requestId) {
        submissionLocked.current = false;
        setIsSubmitting(false);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!isSubmitting && !submissionLocked.current) {
        onClose();
      }
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }

    const controls = focusableControls(dialogRef.current);
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }

    const firstControl = controls[0]!;
    const lastControl = controls[controls.length - 1]!;
    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === firstControl ||
        !dialogRef.current.contains(activeElement))
    ) {
      event.preventDefault();
      lastControl.focus();
    } else if (
      !event.shiftKey &&
      (activeElement === lastControl ||
        !dialogRef.current.contains(activeElement))
    ) {
      event.preventDefault();
      firstControl.focus();
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby="project-editor-title"
        aria-modal="true"
        className="project-editor-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h3 id="project-editor-title">新建项目</h3>
        <form className="project-editor-form" onSubmit={handleSubmit}>
          <label>
            <span>项目名称</span>
            <input
              aria-invalid={fieldErrors.name === undefined ? undefined : true}
              disabled={isSubmitting}
              onChange={(event) => updateField("name", event.target.value)}
              value={form.name}
            />
            {fieldErrors.name ? <small>{fieldErrors.name}</small> : null}
          </label>
          <label>
            <span>年度</span>
            <input
              aria-invalid={fieldErrors.year === undefined ? undefined : true}
              disabled={isSubmitting}
              onChange={(event) => updateField("year", event.target.value)}
              type="number"
              value={form.year}
            />
            {fieldErrors.year ? <small>{fieldErrors.year}</small> : null}
          </label>
          <label>
            <span>类型</span>
            <input
              disabled={isSubmitting}
              onChange={(event) => updateField("type", event.target.value)}
              value={form.type}
            />
            {fieldErrors.type ? <small>{fieldErrors.type}</small> : null}
          </label>
          <label>
            <span>状态</span>
            <select
              disabled={isSubmitting}
              onChange={(event) =>
                updateField("status", event.target.value as ProjectStatus)
              }
              value={form.status}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>阶段</span>
            <input
              disabled={isSubmitting}
              onChange={(event) => updateField("phase", event.target.value)}
              value={form.phase}
            />
            {fieldErrors.phase ? <small>{fieldErrors.phase}</small> : null}
          </label>
          <label>
            <span>归档状态</span>
            <input
              disabled={isSubmitting}
              onChange={(event) =>
                updateField("filingStatus", event.target.value)
              }
              value={form.filingStatus}
            />
            {fieldErrors.filingStatus ? (
              <small>{fieldErrors.filingStatus}</small>
            ) : null}
          </label>
          <label>
            <span>计划完成日期</span>
            <input
              disabled={isSubmitting}
              onChange={(event) =>
                updateField("plannedCompletionDate", event.target.value)
              }
              type="date"
              value={form.plannedCompletionDate}
            />
            {fieldErrors.plannedCompletionDate ? (
              <small>{fieldErrors.plannedCompletionDate}</small>
            ) : null}
          </label>
          <label>
            <span>实际完成日期</span>
            <input
              disabled={isSubmitting}
              onChange={(event) =>
                updateField("actualCompletionDate", event.target.value)
              }
              type="date"
              value={form.actualCompletionDate}
            />
            {fieldErrors.actualCompletionDate ? (
              <small>{fieldErrors.actualCompletionDate}</small>
            ) : null}
          </label>
          <label className="project-editor-form__wide">
            <span>首位负责人</span>
            <select
              aria-label="首位负责人"
              aria-invalid={
                fieldErrors.ownerUserId === undefined ? undefined : true
              }
              disabled={isSubmitting || loadingOwners}
              onChange={(event) => setOwnerUserId(event.target.value)}
              value={ownerUserId}
            >
              <option value="">
                {loadingOwners ? "正在加载负责人" : "请选择负责人"}
              </option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.displayName}（{owner.username}）
                </option>
              ))}
            </select>
            {fieldErrors.ownerUserId ? (
              <small role="alert">{fieldErrors.ownerUserId}</small>
            ) : null}
          </label>
          {error ? (
            <p className="form-error project-editor-form__wide" role="alert">
              {error}
            </p>
          ) : null}
          <div className="project-editor-actions project-editor-form__wide">
            <button
              className="secondary-button"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={isSubmitting || loadingOwners}
              type="submit"
            >
              {isSubmitting ? "创建中" : "创建项目"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
