import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";

export interface LoginViewProps {
  onLogin(username: string, password: string): Promise<void>;
  onSuccess(): void;
}

export function LoginView({ onLogin, onSuccess }: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    let succeeded = false;

    try {
      await onLogin(username, password);
      succeeded = true;
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setPassword("");
      setIsSubmitting(false);
    }

    if (succeeded) {
      onSuccess();
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-card__heading">
        <h2 id="login-title">登录</h2>
        <p>请使用您的账号登录项目管理线上版。</p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>用户名</span>
          <input
            autoComplete="username"
            disabled={isSubmitting}
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>
        <label>
          <span>密码</span>
          <span className="password-input">
            <input
              autoComplete="current-password"
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              required
              type={passwordVisible ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              className="password-input__toggle"
              disabled={isSubmitting}
              onClick={() => setPasswordVisible((visible) => !visible)}
              title={passwordVisible ? "隐藏密码" : "显示密码"}
              type="button"
            >
              {passwordVisible ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
            </button>
          </span>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="primary-button"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "登录中" : "登录"}
        </button>
      </form>
    </section>
  );
}
