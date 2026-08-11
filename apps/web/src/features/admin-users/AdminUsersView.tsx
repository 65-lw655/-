import { Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../api-client.js";
import {
  createAdminUsersClient,
  type ManagedUser,
  type UserRole
} from "./admin-users-client.js";

interface CredentialDisplay {
  title: "激活码仅显示一次" | "重置码仅显示一次";
  ticket: string;
}

type Confirmation =
  | { kind: "disable" | "enable" | "reset"; user: ManagedUser }
  | { kind: "role"; user: ManagedUser; role: UserRole };

export interface AdminUsersViewProps {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

const ROLE_LABELS: Record<UserRole, string> = {
  USER: "成员",
  LEADER: "负责人",
  ADMIN: "管理员"
};

const ACCOUNT_STATUS_LABELS: Record<ManagedUser["accountStatus"], string> = {
  ACTIVE: "启用",
  DISABLED: "停用"
};

const CREDENTIAL_STATUS_LABELS: Record<ManagedUser["credentialStatus"], string> = {
  PENDING_ACTIVATION: "待激活",
  READY: "已就绪",
  RESET_REQUIRED: "待重置"
};

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "请求失败，请稍后重试";
  }
  if (error.status === 403) {
    return "您没有管理用户的权限";
  }
  if (error.code === "LAST_ADMIN_REQUIRED") {
    return "至少保留一名启用且已激活的管理员";
  }
  return error.message;
}

function confirmationCopy(confirmation: Confirmation): { title: string; button: string } {
  switch (confirmation.kind) {
    case "disable":
      return { title: "确认停用账号", button: "确认停用" };
    case "enable":
      return { title: "确认启用账号", button: "确认启用" };
    case "reset":
      return { title: "确认重置密码", button: "确认重置" };
    case "role":
      return { title: "确认调整角色", button: "确认调整" };
  }
}

export function AdminUsersView({ apiBaseUrl, fetchImpl }: AdminUsersViewProps) {
  const client = useMemo(
    () => createAdminUsersClient(apiBaseUrl, fetchImpl),
    [apiBaseUrl, fetchImpl]
  );
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [roleUser, setRoleUser] = useState<ManagedUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("USER");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [credential, setCredential] = useState<CredentialDisplay | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await client.listUsers());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function showIssuedCredential(
    issue: () => Promise<{ ticket: string }>,
    title: CredentialDisplay["title"]
  ): Promise<void> {
    setError(null);
    try {
      const issued = await issue();
      setCredential({ title, ticket: issued.ticket });
      await loadUsers();
    } catch (commandError) {
      setError(errorMessage(commandError));
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const displayName = String(formData.get("displayName") ?? "");
    const role = formData.get("role");
    if (role !== "USER" && role !== "LEADER" && role !== "ADMIN") {
      return;
    }
    setCreateOpen(false);
    await showIssuedCredential(
      () => client.createUser({ username, displayName, role }),
      "激活码仅显示一次"
    );
  }

  async function submitConfirmation(): Promise<void> {
    if (!confirmation) {
      return;
    }

    const currentConfirmation = confirmation;
    setConfirmation(null);
    if (currentConfirmation.kind === "reset") {
      await showIssuedCredential(
        () => client.issuePasswordReset(currentConfirmation.user.id),
        "重置码仅显示一次"
      );
      return;
    }

    setError(null);
    try {
      if (currentConfirmation.kind === "disable") {
        await client.disableUser(currentConfirmation.user.id);
      } else if (currentConfirmation.kind === "enable") {
        await client.enableUser(currentConfirmation.user.id);
      } else if (currentConfirmation.kind === "role") {
        await client.changeRole(currentConfirmation.user.id, currentConfirmation.role);
      }
      await loadUsers();
    } catch (commandError) {
      setError(errorMessage(commandError));
    }
  }

  function openRoleDialog(user: ManagedUser): void {
    setOpenMenuId(null);
    setRoleUser(user);
    setSelectedRole(user.role);
  }

  async function copyCredential(): Promise<void> {
    if (credential && navigator.clipboard) {
      await navigator.clipboard.writeText(credential.ticket);
    }
  }

  const confirmationDetails = confirmation ? confirmationCopy(confirmation) : null;

  return (
    <section className="admin-users" id="user-management" aria-labelledby="admin-users-title">
      <div className="admin-users__heading">
        <div>
          <h2 id="admin-users-title">用户管理</h2>
          <p>开通、维护和恢复系统用户。</p>
        </div>
        <button className="primary-button" onClick={() => setCreateOpen(true)} type="button">
          开通账号
        </button>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <p className="session-message" role="status">正在加载用户</p> : null}

      <div className="admin-users__table-container">
        <table className="admin-users__table">
          <thead>
            <tr>
              <th scope="col">显示名称</th>
              <th scope="col">登录名</th>
              <th scope="col">角色</th>
              <th scope="col">账号状态</th>
              <th scope="col">凭证状态</th>
              <th scope="col">更新时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName}</td>
                <td>{user.username}</td>
                <td>{ROLE_LABELS[user.role]}</td>
                <td>{ACCOUNT_STATUS_LABELS[user.accountStatus]}</td>
                <td>{CREDENTIAL_STATUS_LABELS[user.credentialStatus]}</td>
                <td>{user.updatedAt}</td>
                <td className="admin-users__actions">
                  <button
                    aria-expanded={openMenuId === user.id}
                    className="secondary-button"
                    onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)}
                    type="button"
                  >
                    操作
                  </button>
                  {openMenuId === user.id ? (
                    <div className="admin-users__menu" role="menu">
                      {user.credentialStatus === "PENDING_ACTIVATION" ? (
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            void showIssuedCredential(
                              () => client.reissueActivation(user.id),
                              "激活码仅显示一次"
                            );
                          }}
                          role="menuitem"
                          type="button"
                        >
                          重新签发激活码
                        </button>
                      ) : null}
                      <button onClick={() => openRoleDialog(user)} role="menuitem" type="button">
                        调整角色
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          setConfirmation({
                            kind: user.accountStatus === "ACTIVE" ? "disable" : "enable",
                            user
                          });
                        }}
                        role="menuitem"
                        type="button"
                      >
                        {user.accountStatus === "ACTIVE" ? "停用" : "启用"}
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          setConfirmation({ kind: "reset", user });
                        }}
                        role="menuitem"
                        type="button"
                      >
                        重置密码
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <div className="modal-backdrop">
          <form aria-labelledby="create-user-title" className="admin-dialog" onSubmit={submitCreate}>
            <h3 id="create-user-title">开通账号</h3>
            <label>
              登录名
              <input name="username" required />
            </label>
            <label>
              显示名称
              <input name="displayName" required />
            </label>
            <label>
              角色
              <select defaultValue="USER" name="role">
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <option key={role} value={role}>{label}</option>
                ))}
              </select>
            </label>
            <div className="admin-dialog__actions">
              <button className="secondary-button" onClick={() => setCreateOpen(false)} type="button">取消</button>
              <button className="primary-button" type="submit">确认开通</button>
            </div>
          </form>
        </div>
      ) : null}

      {roleUser ? (
        <div className="modal-backdrop">
          <div aria-labelledby="change-role-title" className="admin-dialog" role="dialog">
            <h3 id="change-role-title">调整角色</h3>
            <label>
              新角色
              <select onChange={(event) => setSelectedRole(event.target.value as UserRole)} value={selectedRole}>
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <option key={role} value={role}>{label}</option>
                ))}
              </select>
            </label>
            <div className="admin-dialog__actions">
              <button className="secondary-button" onClick={() => setRoleUser(null)} type="button">取消</button>
              <button
                className="primary-button"
                onClick={() => {
                  setConfirmation({ kind: "role", user: roleUser, role: selectedRole });
                  setRoleUser(null);
                }}
                type="button"
              >
                继续
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmation && confirmationDetails ? (
        <div className="modal-backdrop">
          <div aria-labelledby="confirmation-title" className="admin-dialog" role="dialog">
            <h3 id="confirmation-title">{confirmationDetails.title}</h3>
            <p>此操作将作用于“{confirmation.user.displayName}”。</p>
            <div className="admin-dialog__actions">
              <button className="secondary-button" onClick={() => setConfirmation(null)} type="button">取消</button>
              <button className="primary-button" onClick={() => void submitConfirmation()} type="button">
                {confirmationDetails.button}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {credential ? (
        <div className="modal-backdrop">
          <div aria-labelledby="credential-title" className="admin-dialog" role="dialog">
            <h3 id="credential-title">{credential.title}</h3>
            <p>请立即安全传递给用户，关闭后无法恢复。</p>
            <div className="credential-display">
              <code>{credential.ticket}</code>
              <button aria-label="复制" className="secondary-button" onClick={() => void copyCredential()} type="button">
                <Copy aria-hidden="true" />
              </button>
            </div>
            <div className="admin-dialog__actions">
              <button className="primary-button" onClick={() => setCredential(null)} type="button">关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
