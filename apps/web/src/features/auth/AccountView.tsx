import { useState, type FormEvent } from "react";

import type { SessionUser } from "./auth-client.js";

export interface AccountViewProps {
  user: SessionUser;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onLogout(): void;
}

export function AccountView({
  user,
  onChangePassword,
  onLogout
}: AccountViewProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword.length < 12) {
      setError("密码至少需要 12 个字符");
      setMessage("");
      return;
    }

    if (newPassword !== confirmation) {
      setError("两次输入的密码不一致");
      setMessage("");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      await onChangePassword(currentPassword, newPassword);
      setMessage("密码已更新");
    } catch {
      setError("修改密码失败，请稍后重试");
    } finally {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="account-card" aria-labelledby="account-title">
      <div>
        <h2 id="account-title">账户</h2>
        <dl className="account-card__details">
          <div>
            <dt>用户 ID</dt>
            <dd>{user.userId}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{user.role}</dd>
          </div>
        </dl>
      </div>
      <form className="auth-form account-password-form" onSubmit={handleSubmit}>
        <label>
          <span>当前密码</span>
          <input
            autoComplete="current-password"
            disabled={isSubmitting}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label>
          <span>新密码</span>
          <input
            autoComplete="new-password"
            disabled={isSubmitting}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
        </label>
        <label>
          <span>确认新密码</span>
          <input
            autoComplete="new-password"
            disabled={isSubmitting}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        <button
          className="primary-button"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "修改中" : "修改密码"}
        </button>
      </form>
      <div className="account-card__actions">
        {user.role === "ADMIN" ? <a href="#user-management">用户管理</a> : null}
        <button className="secondary-button" onClick={onLogout} type="button">
          退出登录
        </button>
      </div>
    </section>
  );
}
