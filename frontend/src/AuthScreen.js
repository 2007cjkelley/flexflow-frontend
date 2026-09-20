import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "./supabaseClient";

// Minimum password bar: 8+ chars, at least one letter, at least one number.
// Returns { valid, message } — message is null when valid.
export function checkPasswordComplexity(pw) {
  if (!pw) return { valid: false, message: "Password is required" };
  if (pw.length < 8) return { valid: false, message: "At least 8 characters" };
  if (!/[A-Za-z]/.test(pw)) return { valid: false, message: "Include at least one letter" };
  if (!/[0-9]/.test(pw)) return { valid: false, message: "Include at least one number" };
  return { valid: true, message: null };
}

// Password input with a show/hide eye toggle. Purely presentational —
// validation and matching are handled by the caller.
export function PasswordField({ label, value, onChange, placeholder = "••••••••", onEnter, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label className="form-label">{label}</label>
      <div className="password-input-wrap">
        <input
          className="form-input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
        />
        <button
          type="button"
          className="password-eye-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <div className="password-hint">{hint}</div>}
    </div>
  );
}

// mode prop: App.js passes "reset" when Supabase fires PASSWORD_RECOVERY
export default function AuthScreen({ onSession, mode: initialMode = "signin" }) {
  const [mode, setMode] = useState(initialMode); // "signin" | "signup" | "verify" | "forgot" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setMessage(null);
    setConfirmPassword("");
    setConfirmNewPassword("");
  };

  const handleSubmit = async () => {
    setError(null);

    if (mode === "signup") {
      const complexity = checkPasswordComplexity(password);
      if (!complexity.valid) return setError(complexity.message);
      if (password !== confirmPassword) return setError("Passwords don't match");
    }
    if (mode === "reset") {
      const complexity = checkPasswordComplexity(newPassword);
      if (!complexity.valid) return setError(complexity.message);
      if (newPassword !== confirmNewPassword) return setError("Passwords don't match");
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMode("verify");
      } else if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSession(data.session);
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage("Reset link sent — check your email.");
      } else if (mode === "reset") {
        // Do NOT call onSession(data.session) here — updateUser() resolves
        // { user }, not { session }, so data.session is always undefined.
        // The real session is set correctly by App.js's onAuthStateChange
        // USER_UPDATED handler; calling onSession(undefined) here would
        // overwrite the "PASSWORD_RECOVERY" sentinel and stall the UI.
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify ──────────────────────────────────────────────────────────────
  if (mode === "verify") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Check your email</h1>
          <p className="auth-subtitle">
            We sent a verification link to <strong>{email}</strong>.<br />
            Click it to activate your account, then come back to sign in.
          </p>
          <button className="add-event-btn" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── Forgot password ──────────────────────────────────────────────────────
  if (mode === "forgot") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-subtitle">
            Enter your email and we'll send a reset link.
          </p>

          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-message">{message}</div>}

          {!message && (
            <div className="auth-field">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}

          {!message && (
            <button
              className="add-event-btn"
              onClick={handleSubmit}
              disabled={loading}
              style={{ width: "100%", marginTop: "8px" }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          )}

          <button className="auth-toggle" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── Reset password (arrived via email link) ──────────────────────────────
  if (mode === "reset") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Set new password</h1>
          <p className="auth-subtitle">Choose a new password for your account.</p>

          {error && <div className="auth-error">{error}</div>}

          <PasswordField
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            onEnter={handleSubmit}
            hint="At least 8 characters, with a letter and a number"
          />

          <PasswordField
            label="Confirm new password"
            value={confirmNewPassword}
            onChange={setConfirmNewPassword}
            onEnter={handleSubmit}
          />

          <button
            className="add-event-btn"
            onClick={handleSubmit}
            disabled={loading}
            style={{ width: "100%", marginTop: "8px" }}
          >
            {loading ? "Saving…" : "Set new password"}
          </button>
        </div>
      </div>
    );
  }

  // ── Sign in / Sign up ────────────────────────────────────────────────────
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">FlexFlow</h1>
        <p className="auth-subtitle">
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          onEnter={handleSubmit}
          hint={mode === "signup" ? "At least 8 characters, with a letter and a number" : undefined}
        />

        {mode === "signup" && (
          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            onEnter={handleSubmit}
          />
        )}

        <button
          className="add-event-btn"
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: "100%", marginTop: "8px" }}
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        {mode === "signin" && (
          <button className="auth-toggle" onClick={() => switchMode("forgot")}>
            Forgot password?
          </button>
        )}

        <button
          className="auth-toggle"
          onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}