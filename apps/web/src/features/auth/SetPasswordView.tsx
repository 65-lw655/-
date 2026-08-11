import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";

export type SetPasswordMode = "activate" | "reset";

export interface SetPasswordViewProps {
  mode: SetPasswordMode;
  onSubmit(ticket: string, password: string): Promise<void>;
  onSuccess(): void;
}

export function SetPasswordView({
  mode,
  onSubmit,
  onSuccess
}: SetPasswordViewProps) {
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const title = mode === "activate" ? "激活账户" : "重设密码";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 12) {
      setError("密码至少需要 12 个字符");
      return;
    }

    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onSubmit(ticket, password);
      setTicket("");
      setPassword("");
      setConfirmation("");
      onSuccess();
    } catch {
      setError("设置密码失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="set-password-title">
      <div className="auth-card__heading">
        <h2 id="set-password-title">{title}</h2>
        <p>请设置至少 12 个字符的新密码。</p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>一次性码</span>
          <input
            autoComplete="one-time-code"
            disabled={isSubmitting}
            onChange={(event) => setTicket(event.target.value)}
            required
            type="password"
            value={ticket}
          />
        </label>
        <label>
          <span>新密码</span>
          <span className="password-input">
            <input
              autoComplete="new-password"
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
        <label>
          <span>确认新密码</span>
          <input
            autoComplete="new-password"
            disabled={isSubmitting}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type={passwordVisible ? "text" : "password"}
            value={confirmation}
          />
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
          {isSubmitting ? "设置中" : "设置密码"}
        </button>
      </form>
    </section>
  );
}
