import {
  validateMemberInput,
  type MemberInput,
  type ProjectMemberRole
} from "@project-online/domain";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";

import { ApiClientError } from "../../api-client.js";
import type {
  MemberCandidate,
  ProjectMemberView,
  ProjectsClient
} from "./projects-client.js";

export interface ProjectMembersPanelProps {
  projectId: string;
  client: ProjectsClient;
  canManageMembers: boolean;
  onBusyChange?(busy: boolean): void;
  onChanged(): void | Promise<void>;
  onSessionExpired(): void;
}

type MembersError = "forbidden" | "hidden" | "failed" | null;
type Feedback =
  | { kind: "success"; message: string; retry: false }
  | { kind: "error"; message: string; retry: boolean }
  | null;

interface MemberFormState {
  memberRole: ProjectMemberRole | "";
  jobTitle: string;
  phone: string;
  remark: string;
}

interface DialogSelection {
  memberId: string;
}

const roleLabels: Readonly<Record<ProjectMemberRole, string>> = {
  OWNER: "负责人",
  EDITOR: "协作编辑",
  VIEWER: "只读成员"
};

const roles = Object.keys(roleLabels) as ProjectMemberRole[];
const emptyForm: MemberFormState = {
  memberRole: "",
  jobTitle: "",
  phone: "",
  remark: ""
};

function displayValue(value: string | undefined): string {
  return value?.trim() || "—";
}

function memberDisplayName(member: ProjectMemberView): string {
  return displayValue(member.user?.displayName);
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function membersErrorFor(error: unknown): MembersError {
  if (error instanceof ApiClientError && error.status === 403) {
    return "forbidden";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "hidden";
  }
  return "failed";
}

function candidateError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "您没有搜索候选成员的权限";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "项目不存在或您无权查看";
  }
  return "候选成员搜索失败，请重试";
}

function mutationError(error: unknown, action: "add" | "update" | "remove") {
  if (error instanceof ApiClientError) {
    if (error.code === "LAST_OWNER_REQUIRED") {
      return "项目必须保留至少一名负责人";
    }
    if (error.code === "MEMBER_ALREADY_EXISTS") {
      return "该用户已是项目成员";
    }
    if (error.status === 404) {
      return "成员不存在或您无权操作";
    }
    if (error.status === 403) {
      return "您没有管理项目成员的权限";
    }
  }

  const labels = { add: "添加", update: "更新", remove: "移除" } as const;
  return `成员${labels[action]}失败，请重试`;
}

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function trapFocus(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement) {
  if (event.key !== "Tab") {
    return;
  }

  const controls = focusableControls(dialog);
  const firstControl = controls[0];
  const lastControl = controls.at(-1);
  if (firstControl === undefined || lastControl === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const activeElement = document.activeElement;
  if (
    event.shiftKey &&
    (activeElement === firstControl || !dialog.contains(activeElement))
  ) {
    event.preventDefault();
    lastControl.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastControl || !dialog.contains(activeElement))
  ) {
    event.preventDefault();
    firstControl.focus();
  }
}

function toMemberInput(form: MemberFormState): MemberInput | null {
  if (form.memberRole === "") {
    return null;
  }
  return {
    memberRole: form.memberRole,
    jobTitle: form.jobTitle,
    phone: form.phone,
    remark: form.remark
  };
}

export function ProjectMembersPanel({
  projectId,
  client,
  canManageMembers,
  onBusyChange,
  onChanged,
  onSessionExpired
}: ProjectMembersPanelProps) {
  const [members, setMembers] = useState<ProjectMemberView[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<MembersError>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateSearchError, setCandidateSearchError] = useState("");
  const [addForm, setAddForm] = useState<MemberFormState>(emptyForm);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState("");
  const [editSelection, setEditSelection] = useState<DialogSelection | null>(
    null
  );
  const [editForm, setEditForm] = useState<MemberFormState>(emptyForm);
  const [editErrors, setEditErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState("");
  const [removeSelection, setRemoveSelection] =
    useState<DialogSelection | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const mounted = useRef(true);
  const membersRequestId = useRef(0);
  const searchRequestId = useRef(0);
  const addLocked = useRef(false);
  const editLocked = useRef(false);
  const removeLocked = useRef(false);
  const refreshLocked = useRef(false);
  const manageTrigger = useRef<HTMLElement | null>(null);
  const editDialog = useRef<HTMLDivElement>(null);
  const removeDialog = useRef<HTMLDivElement>(null);
  const membersRegion = useRef<HTMLElement>(null);
  const restoreEditTrigger = useRef(true);
  const restoreRemoveTrigger = useRef(true);
  const lastBusy = useRef(false);
  const busyCallback = useRef(onBusyChange);
  const busy = addPending || editPending || removePending || refreshPending;

  const editMember =
    canManageMembers && editSelection !== null
      ? (members.find(({ member }) => member.id === editSelection.memberId) ??
        null)
      : null;
  const removeMember =
    canManageMembers && removeSelection !== null
      ? (members.find(({ member }) => member.id === removeSelection.memberId) ??
        null)
      : null;
  const ownerCount = members.reduce(
    (count, item) => count + (item.member.memberRole === "OWNER" ? 1 : 0),
    0
  );
  const editIsOnlyOwner =
    editMember?.member.memberRole === "OWNER" && ownerCount === 1;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      membersRequestId.current += 1;
      searchRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    busyCallback.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    if (lastBusy.current === busy) {
      return;
    }
    lastBusy.current = busy;
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(
    () => () => {
      if (lastBusy.current) {
        lastBusy.current = false;
        busyCallback.current?.(false);
      }
    },
    []
  );

  const loadMembers = useCallback(
    async (showLoading: boolean): Promise<void> => {
      const requestId = ++membersRequestId.current;
      if (showLoading) {
        setMembersLoading(true);
        setMembersError(null);
      }
      try {
        const loadedMembers = await client.listMembers(projectId);
        if (mounted.current && membersRequestId.current === requestId) {
          setMembers(loadedMembers ?? []);
          setMembersError(null);
        }
      } catch (error) {
        if (!mounted.current || membersRequestId.current !== requestId) {
          return;
        }
        if (isSessionExpired(error)) {
          onSessionExpired();
        } else if (showLoading) {
          setMembersError(membersErrorFor(error));
        }
        throw error;
      } finally {
        if (mounted.current && membersRequestId.current === requestId) {
          setMembersLoading(false);
        }
      }
    },
    [client, onSessionExpired, projectId]
  );

  useEffect(() => {
    const requestId = ++membersRequestId.current;
    void Promise.resolve(client.listMembers(projectId))
      .then((loadedMembers) => {
        if (mounted.current && membersRequestId.current === requestId) {
          setMembers(loadedMembers ?? []);
          setMembersError(null);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || membersRequestId.current !== requestId) {
          return;
        }
        if (isSessionExpired(error)) {
          onSessionExpired();
        } else {
          setMembersError(membersErrorFor(error));
        }
      })
      .finally(() => {
        if (mounted.current && membersRequestId.current === requestId) {
          setMembersLoading(false);
        }
      });
  }, [client, onSessionExpired, projectId]);

  useEffect(() => {
    if (canManageMembers) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setEditSelection(null);
      setRemoveSelection(null);
    });
    return () => window.clearTimeout(timeout);
  }, [canManageMembers]);

  useEffect(() => {
    if (editMember === null) {
      return;
    }
    focusableControls(editDialog.current!)[0]?.focus();
    return () => {
      if (restoreEditTrigger.current && manageTrigger.current?.isConnected) {
        manageTrigger.current.focus();
      }
    };
  }, [editMember]);

  useEffect(() => {
    if (removeMember === null) {
      return;
    }
    focusableControls(removeDialog.current!)[0]?.focus();
    return () => {
      if (restoreRemoveTrigger.current && manageTrigger.current?.isConnected) {
        manageTrigger.current.focus();
      }
    };
  }, [removeMember]);

  useEffect(() => {
    if (editPending) {
      editDialog.current?.focus();
    }
  }, [editPending]);

  useEffect(() => {
    if (removePending) {
      removeDialog.current?.focus();
    }
  }, [removePending]);

  async function refreshCompleteState(successMessage: string): Promise<void> {
    let failed = false;
    try {
      await loadMembers(false);
    } catch {
      if (!mounted.current) {
        return;
      }
      failed = true;
    }
    if (!mounted.current) {
      return;
    }
    try {
      await onChanged();
    } catch {
      if (!mounted.current) {
        return;
      }
      failed = true;
    }

    if (!mounted.current) {
      return;
    }
    setFeedback(
      failed
        ? {
            kind: "error",
            message: `${successMessage}，但项目状态刷新失败`,
            retry: true
          }
        : { kind: "success", message: successMessage, retry: false }
    );
  }

  async function retryCompleteRefresh(): Promise<void> {
    if (refreshLocked.current) {
      return;
    }
    refreshLocked.current = true;
    setRefreshPending(true);
    let failed = false;
    try {
      await loadMembers(false);
    } catch {
      if (!mounted.current) {
        refreshLocked.current = false;
        return;
      }
      failed = true;
    }
    if (!mounted.current) {
      refreshLocked.current = false;
      return;
    }
    try {
      await onChanged();
    } catch {
      if (!mounted.current) {
        refreshLocked.current = false;
        return;
      }
      failed = true;
    }

    if (!mounted.current) {
      refreshLocked.current = false;
      return;
    }
    setFeedback(
      failed
        ? {
            kind: "error",
            message: "项目状态刷新失败，请重试",
            retry: true
          }
        : {
            kind: "success",
            message: "项目状态已刷新",
            retry: false
          }
    );
    setRefreshPending(false);
    refreshLocked.current = false;
  }

  function updateAddField<Key extends keyof MemberFormState>(
    key: Key,
    value: MemberFormState[Key]
  ) {
    setAddForm((current) => ({ ...current, [key]: value }));
  }

  function updateEditField<Key extends keyof MemberFormState>(
    key: Key,
    value: MemberFormState[Key]
  ) {
    setEditForm((current) => ({ ...current, [key]: value }));
  }

  function handleSearch(rawQuery: string): void {
    setQuery(rawQuery);
    setSelectedCandidateId("");
    setCandidates([]);
    setCandidateSearchError("");
    const requestId = ++searchRequestId.current;
    const trimmedQuery = rawQuery.trim();
    if (Array.from(trimmedQuery).length < 2) {
      setCandidateLoading(false);
      return;
    }

    setCandidateLoading(true);
    void client
      .searchMemberCandidates(projectId, trimmedQuery)
      .then((loadedCandidates) => {
        if (mounted.current && searchRequestId.current === requestId) {
          setCandidates(loadedCandidates);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || searchRequestId.current !== requestId) {
          return;
        }
        if (isSessionExpired(error)) {
          onSessionExpired();
        } else {
          setCandidateSearchError(candidateError(error));
        }
      })
      .finally(() => {
        if (mounted.current && searchRequestId.current === requestId) {
          setCandidateLoading(false);
        }
      });
  }

  async function addMember(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const input = toMemberInput(addForm);
    if (addLocked.current || selectedCandidateId === "" || input === null) {
      return;
    }
    const validation = validateMemberInput(input);
    if (!validation.ok) {
      setAddError(Object.values(validation.fields)[0] ?? "成员信息无效");
      return;
    }

    addLocked.current = true;
    setAddPending(true);
    setAddError("");
    setFeedback(null);
    try {
      await client.addMember(projectId, {
        userId: selectedCandidateId,
        ...input
      });
      if (!mounted.current) {
        return;
      }
      setQuery("");
      setCandidates([]);
      setSelectedCandidateId("");
      setAddForm(emptyForm);
      searchRequestId.current += 1;
      await refreshCompleteState("成员已添加");
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (isSessionExpired(error)) {
        onSessionExpired();
      } else {
        setAddError(mutationError(error, "add"));
      }
    } finally {
      addLocked.current = false;
      if (mounted.current) {
        setAddPending(false);
      }
    }
  }

  function openEdit(member: ProjectMemberView, trigger: HTMLElement): void {
    manageTrigger.current = trigger;
    restoreEditTrigger.current = true;
    setEditForm({
      memberRole: member.member.memberRole,
      jobTitle: member.member.jobTitle,
      phone: member.member.phone,
      remark: member.member.remark
    });
    setEditErrors({});
    setEditError("");
    setEditSelection({ memberId: member.member.id });
  }

  async function updateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editMember === null || editLocked.current) {
      return;
    }
    const input = toMemberInput(editForm);
    if (input === null) {
      setEditErrors({ memberRole: "请选择成员角色" });
      return;
    }
    const validation = validateMemberInput(input);
    if (!validation.ok) {
      setEditErrors(validation.fields);
      return;
    }

    editLocked.current = true;
    setEditPending(true);
    setEditErrors({});
    setEditError("");
    setFeedback(null);
    const memberId = editMember.member.id;
    try {
      await client.updateMember(projectId, memberId, input);
      if (!mounted.current) {
        return;
      }
      restoreEditTrigger.current = false;
      setEditSelection(null);
      await refreshCompleteState("成员信息已更新");
      if (!mounted.current) {
        return;
      }
      membersRegion.current?.focus();
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (isSessionExpired(error)) {
        onSessionExpired();
      } else {
        setEditError(mutationError(error, "update"));
      }
    } finally {
      editLocked.current = false;
      if (mounted.current) {
        setEditPending(false);
      }
    }
  }

  function openRemove(): void {
    if (editMember === null || editIsOnlyOwner) {
      return;
    }
    restoreEditTrigger.current = false;
    restoreRemoveTrigger.current = true;
    setRemoveError("");
    setRemoveSelection({ memberId: editMember.member.id });
    setEditSelection(null);
  }

  async function confirmRemove(): Promise<void> {
    if (removeMember === null || removeLocked.current) {
      return;
    }
    removeLocked.current = true;
    setRemovePending(true);
    setRemoveError("");
    setFeedback(null);
    const memberId = removeMember.member.id;
    try {
      await client.removeMember(projectId, memberId);
      if (!mounted.current) {
        return;
      }
      restoreRemoveTrigger.current = false;
      setRemoveSelection(null);
      await refreshCompleteState("成员已移除");
      if (!mounted.current) {
        return;
      }
      membersRegion.current?.focus();
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (isSessionExpired(error)) {
        onSessionExpired();
      } else {
        setRemoveError(mutationError(error, "remove"));
      }
    } finally {
      removeLocked.current = false;
      if (mounted.current) {
        setRemovePending(false);
      }
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      if (!editPending) {
        event.preventDefault();
        setEditSelection(null);
      }
      return;
    }
    if (editDialog.current !== null) {
      trapFocus(event, editDialog.current);
    }
  }

  function handleRemoveKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      if (!removePending) {
        event.preventDefault();
        setRemoveSelection(null);
      }
      return;
    }
    if (removeDialog.current !== null) {
      trapFocus(event, removeDialog.current);
    }
  }

  if (membersLoading) {
    return (
      <section aria-labelledby="members-title" className="project-members">
        <h3 id="members-title">项目成员</h3>
        <p role="status">正在加载项目成员</p>
      </section>
    );
  }

  if (membersError !== null) {
    const message =
      membersError === "forbidden"
        ? "您没有查看项目成员的权限"
        : membersError === "hidden"
          ? "项目不存在或您无权查看"
          : "项目成员加载失败，请重试";
    return (
      <section aria-labelledby="members-title" className="project-members">
        <h3 id="members-title">项目成员</h3>
        <div role="alert">
          <p>{message}</p>
          {membersError === "failed" ? (
            <button
              className="secondary-button"
              onClick={() => void loadMembers(true).catch(() => undefined)}
              type="button"
            >
              重试加载成员
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="members-title"
      className="project-members"
      ref={membersRegion}
      tabIndex={-1}
    >
      <h3 id="members-title">项目成员</h3>

      {feedback ? (
        <div
          className={
            feedback.kind === "error"
              ? "project-members__feedback project-members__feedback--error"
              : "project-members__feedback"
          }
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          <p>{feedback.message}</p>
          {feedback.retry ? (
            <button
              className="secondary-button"
              disabled={refreshPending}
              onClick={() => void retryCompleteRefresh()}
              type="button"
            >
              {refreshPending ? "刷新中" : "重试刷新项目状态"}
            </button>
          ) : null}
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="project-members__empty">暂无项目成员</p>
      ) : (
        <div className="project-members__table-container">
          <table className="project-members__table">
            <thead>
              <tr>
                <th>显示名称</th>
                <th>登录名</th>
                <th>项目角色</th>
                <th>职位</th>
                <th>电话</th>
                <th>备注</th>
                <th>账号状态</th>
                {canManageMembers ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((item) => {
                const displayName = memberDisplayName(item);
                return (
                  <tr key={item.member.id}>
                    <td data-label="显示名称">{displayName}</td>
                    <td data-label="登录名">
                      {displayValue(item.user?.username)}
                    </td>
                    <td data-label="项目角色">
                      {roleLabels[item.member.memberRole]}
                    </td>
                    <td data-label="职位">
                      {displayValue(item.member.jobTitle)}
                    </td>
                    <td data-label="电话">{displayValue(item.member.phone)}</td>
                    <td data-label="备注">
                      {displayValue(item.member.remark)}
                    </td>
                    <td data-label="账号状态">
                      {item.user === null
                        ? "—"
                        : item.user.accountStatus === "DISABLED"
                          ? "已停用"
                          : "正常"}
                    </td>
                    {canManageMembers ? (
                      <td data-label="操作">
                        <button
                          className="secondary-button"
                          onClick={(event) =>
                            openEdit(item, event.currentTarget)
                          }
                          type="button"
                        >
                          管理{displayName}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManageMembers ? (
        <section
          aria-labelledby="add-member-title"
          className="project-members__add"
        >
          <h4 id="add-member-title">新增成员</h4>
          <form onSubmit={addMember}>
            <label className="project-members__wide">
              <span>搜索可添加用户</span>
              <input
                disabled={addPending}
                onChange={(event) => handleSearch(event.target.value)}
                value={query}
              />
            </label>
            {candidateLoading ? (
              <p className="project-members__wide" role="status">
                正在搜索候选成员
              </p>
            ) : null}
            {candidateSearchError ? (
              <p className="form-error project-members__wide" role="alert">
                {candidateSearchError}
              </p>
            ) : null}
            {candidates.length > 0 ? (
              <fieldset className="project-members__candidates project-members__wide">
                <legend>选择候选成员</legend>
                {candidates.map((item) => (
                  <label key={item.id}>
                    <input
                      checked={selectedCandidateId === item.id}
                      disabled={addPending}
                      name="member-candidate"
                      onChange={() => setSelectedCandidateId(item.id)}
                      type="radio"
                    />
                    <span>
                      {item.displayName}（{item.username}）
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {!candidateLoading &&
            query.trim() !== "" &&
            Array.from(query.trim()).length >= 2 &&
            candidates.length === 0 &&
            candidateSearchError === "" ? (
              <p className="project-members__wide">未找到可添加用户</p>
            ) : null}
            <label>
              <span>新成员角色</span>
              <select
                disabled={addPending}
                onChange={(event) =>
                  updateAddField(
                    "memberRole",
                    event.target.value as ProjectMemberRole | ""
                  )
                }
                value={addForm.memberRole}
              >
                <option value="">请选择角色</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>新成员职位</span>
              <input
                disabled={addPending}
                onChange={(event) =>
                  updateAddField("jobTitle", event.target.value)
                }
                value={addForm.jobTitle}
              />
            </label>
            <label>
              <span>新成员电话</span>
              <input
                disabled={addPending}
                onChange={(event) =>
                  updateAddField("phone", event.target.value)
                }
                value={addForm.phone}
              />
            </label>
            <label>
              <span>新成员备注</span>
              <textarea
                disabled={addPending}
                onChange={(event) =>
                  updateAddField("remark", event.target.value)
                }
                value={addForm.remark}
              />
            </label>
            {addError ? (
              <p className="form-error project-members__wide" role="alert">
                {addError}
              </p>
            ) : null}
            <div className="project-editor-actions project-members__wide">
              <button
                className="primary-button"
                disabled={
                  addPending ||
                  selectedCandidateId === "" ||
                  addForm.memberRole === ""
                }
                type="submit"
              >
                {addPending ? "添加中" : "添加成员"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {editMember !== null ? (
        <div className="modal-backdrop">
          <div
            aria-describedby={
              [
                editIsOnlyOwner ? "member-edit-owner-warning" : "",
                editError ? "member-edit-error" : ""
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-labelledby="member-edit-title"
            aria-modal="true"
            className="project-member-dialog"
            onKeyDown={handleEditKeyDown}
            ref={editDialog}
            role="dialog"
            tabIndex={-1}
          >
            <h3 id="member-edit-title">管理{memberDisplayName(editMember)}</h3>
            <form onSubmit={updateMember}>
              <label>
                <span>成员角色</span>
                <select
                  disabled={editPending}
                  onChange={(event) =>
                    updateEditField(
                      "memberRole",
                      event.target.value as ProjectMemberRole
                    )
                  }
                  value={editForm.memberRole}
                >
                  {roles.map((role) => (
                    <option
                      disabled={editIsOnlyOwner && role !== "OWNER"}
                      key={role}
                      value={role}
                    >
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
                {editErrors.memberRole ? (
                  <small>{editErrors.memberRole}</small>
                ) : null}
              </label>
              <label>
                <span>职位</span>
                <input
                  disabled={editPending}
                  onChange={(event) =>
                    updateEditField("jobTitle", event.target.value)
                  }
                  value={editForm.jobTitle}
                />
                {editErrors.jobTitle ? (
                  <small>{editErrors.jobTitle}</small>
                ) : null}
              </label>
              <label>
                <span>电话</span>
                <input
                  disabled={editPending}
                  onChange={(event) =>
                    updateEditField("phone", event.target.value)
                  }
                  value={editForm.phone}
                />
                {editErrors.phone ? <small>{editErrors.phone}</small> : null}
              </label>
              <label>
                <span>备注</span>
                <textarea
                  disabled={editPending}
                  onChange={(event) =>
                    updateEditField("remark", event.target.value)
                  }
                  value={editForm.remark}
                />
                {editErrors.remark ? <small>{editErrors.remark}</small> : null}
              </label>
              {editIsOnlyOwner ? (
                <p id="member-edit-owner-warning">
                  项目必须保留至少一名负责人，当前成员不能降级或移除。
                </p>
              ) : null}
              {editError ? (
                <p className="form-error" id="member-edit-error" role="alert">
                  {editError}
                </p>
              ) : null}
              <div className="project-member-dialog__actions">
                <button
                  className="secondary-button project-member-dialog__remove"
                  disabled={editPending || editIsOnlyOwner}
                  onClick={openRemove}
                  type="button"
                >
                  移除成员
                </button>
                <button
                  className="secondary-button"
                  disabled={editPending}
                  onClick={() => setEditSelection(null)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={editPending}
                  type="submit"
                >
                  {editPending ? "保存中" : "保存成员修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {removeMember !== null ? (
        <div className="modal-backdrop">
          <div
            aria-describedby={
              removeError
                ? "member-remove-description member-remove-error"
                : "member-remove-description"
            }
            aria-labelledby="member-remove-title"
            aria-modal="true"
            className="project-member-remove-dialog"
            onKeyDown={handleRemoveKeyDown}
            ref={removeDialog}
            role="alertdialog"
            tabIndex={-1}
          >
            <h3 id="member-remove-title">
              移除{memberDisplayName(removeMember)}
            </h3>
            <p id="member-remove-description">
              确认将“{memberDisplayName(removeMember)}”从项目成员中移除吗？
            </p>
            {removeError ? (
              <p className="form-error" id="member-remove-error" role="alert">
                {removeError}
              </p>
            ) : null}
            <div className="project-editor-actions">
              <button
                className="secondary-button"
                disabled={removePending}
                onClick={() => setRemoveSelection(null)}
                type="button"
              >
                取消移除
              </button>
              <button
                className="primary-button"
                disabled={removePending}
                onClick={() => void confirmRemove()}
                type="button"
              >
                {removePending ? "移除中" : "确认移除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
