import { useState, useRef, useEffect } from "react";
import { User } from "lucide-react";
import axios from "axios";
import { supabase } from "./supabaseClient";
import { PasswordField, checkPasswordComplexity } from "./AuthScreen";

// Profile button + dropdown: log off, change password, delete account.
// `api` is the base API url (same `API` constant used elsewhere in App.js)
// and `email` is the signed-in user's email, shown in the delete-account
// type-to-confirm step.
//
// `hasNewShares` (Calendar Sharing feature Phase 2) drives the badge on the
// profile icon; `onOpenSharedCalendars` opens the same Import-list
// component App.js's own Import flow uses -- this is a second entry point
// into that one list, not a separate view.
export default function ProfileMenu({ api, email, hasNewShares = false, onOpenSharedCalendars }) {
  const [open, setOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // null | "change" | "delete"
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        className="profile-menu-btn"
        onClick={() => setOpen((v) => !v)}
        title={email || "Account"}
        aria-label="Account menu"
        data-testid="profile-menu-btn"
      >
        <User size={18} />
        {hasNewShares && (
          <span
            className="profile-menu-badge"
            aria-label="New shared calendars to review"
            data-testid="profile-menu-badge"
          />
        )}
      </button>

      {open && (
        <div className="profile-menu-dropdown">
          {email && <div className="profile-menu-email">{email}</div>}
          <div className="profile-menu-section-label">Messages</div>
          <button
            className="profile-menu-item"
            data-testid="profile-menu-shared-calendars"
            onClick={() => {
              setOpen(false);
              onOpenSharedCalendars && onOpenSharedCalendars();
            }}
          >
            Shared calendars
          </button>
          <button
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              supabase.auth.signOut();
            }}
          >
            Log off
          </button>
          <button
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setActiveModal("change");
            }}
          >
            Change password
          </button>
          <button
            className="profile-menu-item profile-menu-item-danger"
            onClick={() => {
              setOpen(false);
              setActiveModal("delete");
            }}
          >
            Delete account
          </button>
        </div>
      )}

      {activeModal === "change" && (
        <ChangePasswordModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "delete" && (
        <DeleteAccountModal api={api} onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    const complexity = checkPasswordComplexity(newPassword);
    if (!complexity.valid) return setError(complexity.message);
    if (newPassword !== confirmPassword) return setError("Passwords don't match");

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setMessage("Password updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Change password</h2>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-message">{message}</div>}

        {!message && (
          <>
            <PasswordField
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              onEnter={handleSubmit}
              hint="At least 8 characters, with a letter and a number"
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              onEnter={handleSubmit}
            />
          </>
        )}

        <div className="modal-actions">
          <button className="auth-toggle" onClick={onClose}>
            {message ? "Close" : "Cancel"}
          </button>
          {!message && (
            <button className="add-event-btn" onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving…" : "Update password"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteAccountModal({ api, onClose }) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Calendar Sharing feature Phase 2: who loses events they created on a
  // calendar this account owns, if any. Fetched once on mount from the
  // read-only preview endpoint so the warning below is accurate before the
  // irreversible delete happens, not just implied by the copy.
  const [impact, setImpact] = useState(null); // null while loading
  const [showImpactDetails, setShowImpactDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${api}/account/deletion-impact`)
      .then((res) => {
        if (!cancelled) setImpact(res.data.affected_users || []);
      })
      .catch(() => {
        // Fails open to the plain (no-warning) copy rather than blocking
        // the modal on a preview call that isn't itself the delete.
        if (!cancelled) setImpact([]);
      });
    return () => { cancelled = true; };
  }, [api]);

  const canDelete = confirmText.trim().toLowerCase() === "delete";
  const hasImpact = Array.isArray(impact) && impact.length > 0;

  const handleDelete = async () => {
    if (!canDelete) return;
    setError(null);
    setLoading(true);
    try {
      await axios.delete(`${api}/account`);
      await supabase.auth.signOut();
      // App.js session listener will pick up the sign-out and route back to AuthScreen.
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Delete account</h2>
        <p className="auth-subtitle">
          This permanently deletes your account and all of your events and settings.
          This can't be undone.
        </p>

        {hasImpact && (
          <>
            <p className="auth-error" data-testid="delete-account-share-warning">
              Some of your calendars are shared, and other users have created events on
              them. Deleting your account deletes those calendars, and the events those
              users created on them, too.
            </p>
            <button
              type="button"
              className="auth-toggle"
              onClick={() => setShowImpactDetails((v) => !v)}
              data-testid="delete-account-impact-toggle"
            >
              {showImpactDetails ? "Hide" : "Show"} affected users ({impact.length})
            </button>
            {showImpactDetails && (
              <ul className="delete-account-impact-list" data-testid="delete-account-impact-list">
                {impact.map((entry) => (
                  <li key={entry.email}>
                    {entry.email} — {entry.event_count} event{entry.event_count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label className="form-label">
            Type <strong>delete</strong> to confirm
          </label>
          <input
            className="form-input"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="delete"
          />
        </div>

        <div className="modal-actions">
          <button className="auth-toggle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="delete-btn"
            onClick={handleDelete}
            disabled={!canDelete || loading}
          >
            {loading ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}
