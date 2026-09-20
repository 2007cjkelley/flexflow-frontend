import { useEffect, useState } from "react";
import { Pencil, Eye, X, TriangleAlert, ChevronLeft, Copy, Send } from "lucide-react";

// Calendar Sharing -- Calendar Sharing feature Phase 2 (real backend).
//
// Phase 1 built this UI against local/mocked state. Phase 2 wired it to the
// real access join table via the /calendars/{id}/share and
// /calendars/{id}/access endpoints -- this file
// itself stays free of axios/API-constant coupling, matching App.js's
// existing convention of owning all network calls; callers pass in the
// actual fetch/share/remove functions as props.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getInitials(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "?";
  const namePart = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const words = namePart.split(/[.\s_-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return namePart.slice(0, 2).toUpperCase();
}

export function InitialsAvatar({ label, className = "" }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ${className}`}
      aria-hidden="true"
    >
      {getInitials(label)}
    </span>
  );
}

// Email + Pencil(write)/Eye(read) permission icons, with a conditional
// full-detail-vs-blocks-only sub-prompt for read access. Reused inline on a
// calendar row (single recipient, sender-side share) and inside the
// per-calendar Settings/roster view (repeatable, multi-recipient) --
// `onShare` fires once per recipient either way. The caller decides what
// happens next: close the form (single-recipient use) or just let it reset
// for the next recipient (multi-recipient use, since this component always
// clears itself after finalizing).
//
// `onShare` is async and returns {ok: true} or {ok: false, message} -- the
// form only clears itself on success (e.g. a no-account-match error keeps
// the entered email on screen so the sender can see what went wrong instead
// of it silently vanishing).
export function ShareForm({ onShare, onCancel, testIdPrefix = "share-form" }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("form"); // "form" | "detail"
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());

  const finalize = async (permission, detail) => {
    setSubmitting(true);
    setError(null);
    const result = await onShare({ email: email.trim(), permission, detail });
    setSubmitting(false);
    if (result?.ok) {
      setEmail("");
      setStep("form");
    } else {
      setError(result?.message || "Couldn't share this calendar");
    }
  };

  if (step === "detail") {
    return (
      <div className="flex flex-col gap-2" data-testid={`${testIdPrefix}-detail-prompt`}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setStep("form")}
            aria-label="Back"
            className="flex items-center text-muted-foreground hover:text-foreground"
            data-testid={`${testIdPrefix}-detail-back-btn`}
          >
            <ChevronLeft size={13} />
          </button>
          What can {email.trim()} see?
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => finalize("read", "full")}
            className="flex-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            data-testid={`${testIdPrefix}-detail-full`}
          >
            Full event detail
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => finalize("read", "blocks-only")}
            className="flex-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            data-testid={`${testIdPrefix}-detail-blocks-only`}
          >
            Blocks only
          </button>
        </div>
        {error && (
          <div className="text-[11px] text-destructive" data-testid={`${testIdPrefix}-error`}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid={`${testIdPrefix}-form`}>
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          data-testid={`${testIdPrefix}-email-input`}
        />
        <button
          type="button"
          disabled={!emailValid || submitting}
          onClick={() => finalize("write", "full")}
          title="Write access"
          aria-label="Share with write access"
          className="flex items-center rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          data-testid={`${testIdPrefix}-permission-write`}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          disabled={!emailValid || submitting}
          onClick={() => setStep("detail")}
          title="Read access"
          aria-label="Share with read access"
          className="flex items-center rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          data-testid={`${testIdPrefix}-permission-read`}
        >
          <Eye size={14} />
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="flex items-center rounded p-1 text-muted-foreground hover:text-foreground"
            data-testid={`${testIdPrefix}-cancel-btn`}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {error && (
        <div className="text-[11px] text-destructive" data-testid={`${testIdPrefix}-error`}>
          {error}
        </div>
      )}
    </div>
  );
}

// Unified list of calendars available to import: native FlexFlow shares and
// externally-imported calendars, in one reusable shell. Both the Import
// flow (Part B) and the profile menu's Messages -> Shared calendars entry
// (Part C) render this same component/state, not separate views.
//
// entries come from App.js's own `calendars` state (calendars.filter(c =>
// !c.is_owner)) -- since Calendar Sharing feature Phase 2 shares are live
// immediately, GET /calendars already includes them, so there's no separate
// "shares received" fetch. `source` is always "native" for now; the
// "external" ⚠ variant stays supported here (unused until a non-native
// import path exists -- Phase 3/4) rather than removed, since nothing about
// it needs to change to work then.
export function ImportCalendarsList({ entries, testId = "import-calendars-list" }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {entries.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground" data-testid={`${testId}-empty`}>
          No calendars to import yet.
        </div>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2.5 rounded-md border border-input px-2.5 py-2"
            data-testid={`import-calendar-row-${entry.id}`}
          >
            <InitialsAvatar label={entry.ownerLabel} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">{entry.calendarName}</span>
              <span className="truncate text-[11px] text-muted-foreground">{entry.ownerLabel}</span>
            </div>
            {entry.source === "external" && (
              <span
                title="Not a live connection — this calendar was imported from outside FlexFlow and won't sync automatically yet"
                aria-label="Not a live connection"
                className="flex shrink-0 items-center text-amber-500"
                data-testid={`import-calendar-warning-${entry.id}`}
              >
                <TriangleAlert size={14} />
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// Settings/roster view (gear icon): a multi-recipient ShareForm above the
// real roster of everyone with access to this calendar, with per-person
// removal. Mount with key={calendarId} so switching calendars starts from a
// fresh fetch rather than carrying over the previous one's state.
//
// fetchRoster(calendarId) -> {ok, roster} | {ok: false, message}
// onShare(calendarId, {email, permission, detail}) -> {ok, access} | {ok: false, message}
// onRemove(calendarId, accessId) -> {ok} | {ok: false, message}
// onResend(calendarId, accessId) -> {ok: true, emailSent} | {ok: false, cooldown: true, retryAfterSeconds} | {ok: false, message}
export function CalendarRosterPanel({ calendarId, fetchRoster, onShare, onRemove, onResend }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [resendFlash, setResendFlash] = useState({}); // id -> "sent" | "failed"
  const [resendCooldown, setResendCooldown] = useState({}); // id -> seconds remaining
  // Calendar Sharing feature Phase 3b -- a share/resend whose email_sent
  // came back false stays flagged here until a later resend succeeds.
  // The once-only auto-send rule means a failed first send never retries
  // on its own, so this can't just be a silent miss -- see ShareForm/App.js
  // for the matching "Shared — email failed" framing on the inline path.
  const [emailWarnings, setEmailWarnings] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchRoster(calendarId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRoster(result.roster);
      } else {
        setLoadError(result.message || "Couldn't load who has access");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [calendarId, fetchRoster]);

  // Ticks every resendCooldown entry down once a second, dropping any that
  // reach zero so the button re-enables on its own.
  useEffect(() => {
    if (Object.keys(resendCooldown).length === 0) return undefined;
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        const next = {};
        for (const [id, seconds] of Object.entries(prev)) {
          if (seconds > 1) next[id] = seconds - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const handleAddRecipient = async (entry) => {
    const result = await onShare(calendarId, entry);
    if (result.ok) {
      setRoster((prev) => [...prev.filter((person) => person.email !== result.access.email), result.access]);
      setEmailWarnings((prev) => {
        const next = new Set(prev);
        if (result.access.email_sent === false) {
          next.add(result.access.id);
        } else {
          next.delete(result.access.id);
        }
        return next;
      });
    }
    return result;
  };

  const handleRemove = async (accessId) => {
    const result = await onRemove(calendarId, accessId);
    if (result.ok) {
      setRoster((prev) => prev.filter((person) => person.id !== accessId));
    }
  };

  const handleCopy = async (person) => {
    try {
      await navigator.clipboard.writeText(person.feed_url);
      setCopiedId(person.id);
      setTimeout(() => setCopiedId((id) => (id === person.id ? null : id)), 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  };

  const handleResend = async (accessId) => {
    const result = await onResend(calendarId, accessId);
    if (!result.ok) {
      if (result.cooldown) {
        setResendCooldown((prev) => ({ ...prev, [accessId]: result.retryAfterSeconds }));
      }
      return;
    }
    setResendFlash((prev) => ({ ...prev, [accessId]: result.emailSent ? "sent" : "failed" }));
    setEmailWarnings((prev) => {
      const next = new Set(prev);
      if (result.emailSent) {
        next.delete(accessId);
      } else {
        next.add(accessId);
      }
      return next;
    });
    setTimeout(() => {
      setResendFlash((prev) => {
        const next = { ...prev };
        delete next[accessId];
        return next;
      });
    }, 2000);
  };

  return (
    <div className="flex flex-col gap-3" data-testid={`calendar-roster-panel-${calendarId}`}>
      <ShareForm onShare={handleAddRecipient} testIdPrefix={`calendar-roster-share-form-${calendarId}`} />
      <div className="flex flex-col gap-1" data-testid={`calendar-roster-list-${calendarId}`}>
        {loading ? (
          <div className="py-3 text-center text-xs text-muted-foreground" data-testid={`calendar-roster-loading-${calendarId}`}>
            Loading…
          </div>
        ) : loadError ? (
          <div className="py-3 text-center text-xs text-destructive" data-testid={`calendar-roster-load-error-${calendarId}`}>
            {loadError}
          </div>
        ) : roster.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground" data-testid={`calendar-roster-empty-${calendarId}`}>
            No one has access yet.
          </div>
        ) : (
          roster.map((person) => {
            const cooldown = resendCooldown[person.id];
            const flash = resendFlash[person.id];
            return (
              <div key={person.id} className="flex flex-col">
                <div
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/50"
                  data-testid={`calendar-roster-row-${person.id}`}
                >
                  <InitialsAvatar label={person.email} />
                  <span className="min-w-0 flex-1 truncate text-xs">{person.email}</span>
                  <span
                    className="flex items-center text-muted-foreground"
                    title={person.permission_level === "write" ? "Write access" : "Read access"}
                  >
                    {person.permission_level === "write" ? <Pencil size={13} /> : <Eye size={13} />}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(person)}
                    aria-label={`Copy subscription link for ${person.email}`}
                    title="Copy .ics subscription link"
                    className="flex items-center rounded p-1 text-muted-foreground hover:text-foreground"
                    data-testid={`calendar-roster-copy-${person.id}`}
                  >
                    {copiedId === person.id ? (
                      <span className="text-[10px]">Copied!</span>
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResend(person.id)}
                    disabled={!!cooldown}
                    aria-label={`Resend invite email to ${person.email}`}
                    title={cooldown ? `Try again in ${cooldown}s` : "Resend invite email"}
                    className="flex items-center rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    data-testid={`calendar-roster-resend-${person.id}`}
                  >
                    {flash === "sent" ? (
                      <span className="text-[10px]">Sent!</span>
                    ) : flash === "failed" ? (
                      <span className="text-[10px] text-destructive">Failed</span>
                    ) : cooldown ? (
                      <span className="text-[10px]">{cooldown}s</span>
                    ) : (
                      <Send size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(person.id)}
                    aria-label={`Remove ${person.email}`}
                    className="flex items-center rounded p-1 text-muted-foreground hover:text-destructive"
                    data-testid={`calendar-roster-remove-${person.id}`}
                  >
                    <X size={12} />
                  </button>
                </div>
                {emailWarnings.has(person.id) && (
                  <div
                    className="pl-8 pb-1 text-[11px] text-destructive"
                    data-testid={`calendar-roster-email-warning-${person.id}`}
                  >
                    Shared, but the invite email didn't send — you can resend in a moment.
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
