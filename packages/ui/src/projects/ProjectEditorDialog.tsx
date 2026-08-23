import {
  PROJECT_STATUSES,
  validateProjectInput,
  type ProjectInput,
  type ProjectRecord,
  type ProjectStatus
} from "@project-online/domain";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";

import {
  ProjectRepositoryError,
  type ProjectDetails,
  type ProjectRepository
} from "./repository.js";

export interface ProjectEditorDialogProps {
  details: ProjectDetails;
  repository: ProjectRepository;
  onClose(): void;
  onSaved(details: ProjectDetails): void;
  onAuthenticationRequired?(): void;
  submitLabel?: string;
}

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

function initialForm(project: ProjectRecord): ProjectFormState {
  return {
    name: project.name,
    year: String(project.year),
    type: project.type,
    status: project.status,
    phase: project.phase,
    filingStatus: project.filingStatus,
    plannedCompletionDate: project.plannedCompletionDate ?? "",
    actualCompletionDate: project.actualCompletionDate ?? ""
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

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ProjectRepositoryError)) {
    return "项目保存失败，请重试";
  }
  if (error.code === "PROJECT_FORBIDDEN") {
    return "您没有编辑项目的权限";
  }
  return error.message;
}

export function ProjectEditorDialog({
  details,
  repository,
  onClose,
  onSaved,
  onAuthenticationRequired,
  submitLabel = "保存项目"
}: ProjectEditorDialogProps) {
  const [form, setForm] = useState<ProjectFormState>(() =>
    initialForm(details.project)
  );
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const submissionRequest = useRef(0);
  const submissionLocked = useRef(false);

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

  function updateField<Key extends keyof ProjectFormState>(
    key: Key,
    value: ProjectFormState[Key]
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

    submissionLocked.current = true;
    const requestId = ++submissionRequest.current;
    setIsSubmitting(true);
    setFieldErrors({});
    setError("");

    try {
      const saved = await repository.updateProject(details.project.id, input);
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
      if (
        saveError instanceof ProjectRepositoryError &&
        saveError.code === "AUTHENTICATION_REQUIRED"
      ) {
        onAuthenticationRequired?.();
        return;
      }

      if (
        saveError instanceof ProjectRepositoryError &&
        saveError.code === "VALIDATION_FAILED"
      ) {
        setFieldErrors(saveError.fieldErrors ?? {});
        setError("");
        return;
      }

      setError(errorMessage(saveError));
    } finally {
      if (mounted.current && submissionRequest.current === requestId) {
        submissionLocked.current = false;
        setIsSubmitting(false);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      if (!isSubmitting) {
        event.preventDefault();
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
        <h3 id="project-editor-title">编辑项目</h3>
        <form className="project-editor-form" onSubmit={handleSubmit}>
          <label>
            <span>项目名称</span>
            <input
              aria-label="项目名称"
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
              aria-label="年度"
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
              aria-label="类型"
              disabled={isSubmitting}
              onChange={(event) => updateField("type", event.target.value)}
              value={form.type}
            />
            {fieldErrors.type ? <small>{fieldErrors.type}</small> : null}
          </label>
          <label>
            <span>状态</span>
            <select
              aria-label="状态"
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
              aria-label="阶段"
              disabled={isSubmitting}
              onChange={(event) => updateField("phase", event.target.value)}
              value={form.phase}
            />
            {fieldErrors.phase ? <small>{fieldErrors.phase}</small> : null}
          </label>
          <label>
            <span>归档状态</span>
            <input
              aria-label="归档状态"
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
              aria-label="计划完成日期"
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
              aria-label="实际完成日期"
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
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "保存中" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
