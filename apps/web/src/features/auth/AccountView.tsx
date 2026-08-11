import type { SessionUser } from "./auth-client.js";

export interface AccountViewProps {
  user: SessionUser;
  onLogout(): void;
}

export function AccountView({ user, onLogout }: AccountViewProps) {
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
      <div className="account-card__actions">
        {user.role === "ADMIN" ? <a href="#user-management">用户管理</a> : null}
        <button className="secondary-button" onClick={onLogout} type="button">
          退出登录
        </button>
      </div>
    </section>
  );
}
