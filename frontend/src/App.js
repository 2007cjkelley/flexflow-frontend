import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useClock } from "@/hooks/useClock";
import "@/App.css";
import axios from "axios";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, addWeeks, subWeeks, isSameMonth, isSameDay, getHours, setHours, setMinutes } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Repeat, GripVertical, Settings, X, Eye, EyeOff, EyeClosed, Waves, SquaresIntersect, Import as ImportIcon, Clock, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ImportCalendarsList, CalendarRosterPanel } from "./CalendarSharing";
import { supabase } from "./supabaseClient";
import AuthScreen from "./AuthScreen";
import ProfileMenu from "./ProfileMenu";

// Default to local backend for development; override by setting REACT_APP_BACKEND_URL in an .env file.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8001";
const API = `${BACKEND_URL}/api`;

// Axios request interceptor: attach the current Supabase access token per-request
// so every call carries a fresh token regardless of when axios.defaults was last set.
axios.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers = config.headers || {};
    config.headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return config;
});
const PANEL_LAYOUT_KEY = "flexflow-panel-layout";
const LEFT_PANEL_DEFAULT_WIDTH = 300;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 480;
const QUEUE_PANEL_DEFAULT_WIDTH = 320;
const QUEUE_PANEL_MIN_WIDTH = 240;
const QUEUE_PANEL_MAX_WIDTH = 500;

const EVENT_CATEGORIES = [
  { value: "Work", label: "Work", className: "event-work" },
  { value: "Personal", label: "Personal", className: "event-personal" },
  { value: "Urgent", label: "Urgent", className: "event-urgent" },
  { value: "Meeting", label: "Meeting", className: "event-meeting" },
];

// Single source of truth for "this calendar has no color set yet" -- the
// sidebar calendar-row swatch and the event-card background (below) must
// never drift into two different defaults.
const DEFAULT_CALENDAR_COLOR = "#A3A3A3";

const RECURRENCE_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// Sunday=0 .. Saturday=6, matching the day_of_week convention the backend
// uses for its closed-block generation.
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// Helper to get unique name handling duplicates
const getUniqueName = (name, existingNames) => {
  if (!existingNames.includes(name)) {
    return name;
  }
  const suffixMatch = name.match(/^(.+)_(\d+)$/);
  const baseName = suffixMatch ? suffixMatch[1] : name;
  let highestSuffix = 0;
  existingNames.forEach(existingName => {
    if (existingName === baseName) {
      highestSuffix = Math.max(highestSuffix, 0);
    }
    const match = existingName.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`));
    if (match) {
      highestSuffix = Math.max(highestSuffix, parseInt(match[1]));
    }
  });
  return `${baseName}_${highestSuffix + 1}`;
};

const TIMEZONE_OPTIONS = [
    { value: "local", label: "Local" },
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central Europe (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

// Resolves "local" to the browser's IANA timezone, passes all other values through unchanged.
// Use this wherever globalSettings.timezone is consumed, so "local" is always expanded before use.
const getEffectiveTimezone = (tz) => {
  if (tz === "local") return Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz;
};

// Extracts the hour and minute of an ISO timestamp in the global timezone (not browser local time).
// Used for placing events on the correct hour row of the calendar grid.
// For naive events, converts using home_timezone instead of current timezone.
const getLocalizedHoursMinutes = (isoString, tz, timezoneMode = "absolute", homeTimezone = null) => {
  const effectiveTz = (timezoneMode === "naive" && homeTimezone) ? homeTimezone : tz;
  const effective = getEffectiveTimezone(effectiveTz);
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: effective,
  }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === "hour").value);
  const m = parseInt(parts.find(p => p.type === "minute").value);
  return { hours: h, minutes: m };
};

// Compute UTC offset in minutes from an IANA timezone name
const getTimezoneOffsetMinutes = (tz) => {
  const now = new Date();
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return Math.round((local - utc) / 60000);
};

// Converts a UTC ISO string to a naive "yyyy-MM-ddTHH:mm" string expressed
// in the given IANA timezone — for populating datetime-local inputs correctly.
const utcIsoToTzLocal = (isoString, tz) => {
  const effective = getEffectiveTimezone(tz);
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: effective,
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type).value;
  // Intl hour12:false can return "24" for midnight — clamp to "00"
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
};

// Interprets a naive "yyyy-MM-ddTHH:mm" string as being in the given IANA
// timezone and returns a UTC ISO string — for sending correct UTC to the backend.
const tzLocalToUtcIso = (naiveDatetime, tz) => {
  const effective = getEffectiveTimezone(tz);
  const offsetMin = getTimezoneOffsetMinutes(effective);
  // Parsing with "Z" treats the string as UTC; subtracting the offset converts to true UTC.
  const utcMs = new Date(naiveDatetime + "Z").getTime() - offsetMin * 60000;
  return new Date(utcMs).toISOString();
};

const getCalendarDateForTimezone = (isoString, tz) => {
  const dateStr = utcIsoToTzLocal(isoString, tz).slice(0, 10);
  return new Date(`${dateStr}T12:00:00`);
};

const getTimezoneDayBounds = (date, tz) => {
  const effective = getEffectiveTimezone(tz);
  const offsetMs = getTimezoneOffsetMinutes(effective) * 60000;
  const dateStr = format(date, "yyyy-MM-dd");
  const dayStart = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
};

// Custom tooltip for flex queue items — shows each fragment's start–end time.
function FlexTooltip({ fragments, divRef, timezone }) {
  if (!fragments || fragments.length === 0) return null;
  const sorted = [...fragments].sort(
    (a, b) => new Date(a.start_time) - new Date(b.start_time)
  );
  const tooltipTimezone = getEffectiveTimezone(timezone);
  return (
    <div ref={divRef} style={{
      position: "fixed",
      top: 0,
      left: 0,
      background: "#1e293b",
      color: "#f1f5f9",
      borderRadius: "6px",
      padding: "6px 10px",
      fontSize: "12px",
      lineHeight: "1.7",
      whiteSpace: "nowrap",
      boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      zIndex: 1000,
      pointerEvents: "none",
      opacity: 0,
    }}>
      {sorted.map((f, i) => (
        <div key={i}>
          {new Date(f.start_time).toLocaleTimeString("en-US", { timeZone: tooltipTimezone, hour: "numeric", minute: "2-digit" })} – {new Date(f.end_time).toLocaleTimeString("en-US", { timeZone: tooltipTimezone, hour: "numeric", minute: "2-digit" })}
        </div>
      ))}
    </div>
  );
}

// Shared left-chevron header for collapsible config-panel sections
// (Description, Category, Repeat, Timezone Mode).
function CollapsibleSectionHeader({ label, expanded, onToggle, disabled, testId }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "6px", cursor: disabled ? "default" : "pointer", userSelect: "none" }}
      onClick={disabled ? undefined : onToggle}
      data-testid={testId}
    >
      <ChevronRight
        size={14}
        style={{
          color: "var(--muted-foreground)",
          flexShrink: 0,
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 0.15s ease",
        }}
      />
      <label className="form-label" style={{ cursor: disabled ? "default" : "pointer", marginBottom: 0 }}>{label}</label>
    </div>
  );
}

function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [clockDisplay, setClockDisplay] = useState('');
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out, object = logged in

  useClock((now) => {
    setClockDisplay(new Date(now).toLocaleTimeString("en-US", { timeZone: getEffectiveTimezone(globalSettings.timezone) }));
    if (flexEvents.length === 0) return;
    // Active item = lowest (priority, position), not raw array index 0 --
    // matches the same key the placement engine sorts by (Phase 2).
    // Array.sort is stable, so equal-priority ties preserve existing
    // array order, which is already position order (GET /flex-events is
    // position-ordered server-side, nothing re-sorts client-side).
    const currentItem = [...flexEvents].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))[0];
    if (currentItem.isTemp) return;
    if (currentItem.completed) return;
    const maxElapsed = currentItem.duration * 60;

    const handleTickUpdateError = (error, message) => {
      if (error.response?.status === 404) {
        fetchFlexEvents();
        return;
      }
      console.error(message, error);
    };

    if ((currentItem.FF_time_elapsed ?? 0) >= maxElapsed) {
      axios
        .put(`${API}/flex-events/${currentItem.id}`, { completed: true, FF_time_elapsed: maxElapsed, FF_time_remaining: 0 })
        .catch((error) => handleTickUpdateError(error, "Failed to complete flex item on clock tick"));
      fetchFlexEvents();
      return;
    }

    // Pause aging when now is outside every open block the engine last
    // reported (openBlocks, kept fresh by the effect that refetches it on
    // calendar/open-block-row/intersect/wave changes -- not recomputed
    // here).
    const isOpen = (openBlocks?.open_blocks || []).some(
      (b) => now >= Date.parse(b.start) && now < Date.parse(b.end)
    );
    if (!isOpen) return;

    // Live backstop for a real staleness gap: openBlocks above is never
    // refetched on rigid event create/edit/move/delete (handleSaveRigidEvent
    // only calls fetchEvents(), never fetchOpenBlocksData()), so a rigid
    // event moved onto "now" needs this synchronous check against the
    // freshly-refetched `events` array, not isOpen alone. Only a rigid event
    // that shares a calendar with the active flow-around selection can block
    // it -- scanning every rigid event on every calendar with no filtering
    // would freeze aging even for a calendar the queue doesn't flow around.
    const isInsideRigid = events.some(e => {
      const s = new Date(e.start_time).getTime();
      const en = new Date(e.end_time).getTime();
      if (!(now >= s && now < en)) return false;
      return (e.calendar_ids || []).some((id) => flowAroundCalendarIds.includes(id));
    });
    if (isInsideRigid) return;

    const newElapsed = (currentItem.FF_time_elapsed ?? 0) + 1;

    setFlexEvents(prev => {
      // Id-based, not index-0 -- the active item (lowest priority,position)
      // may not be at array index 0.
      if (prev.length === 0) return prev;
      return prev.map(item => item.id === currentItem.id ? { ...item, FF_time_elapsed: newElapsed } : item);
    });

    // Skip the DB write if a save is currently in-flight — the save already
    // wrote the correct elapsed value (0 on duration change, unchanged on
    // name-only change) and we don't want a stale tick to overwrite it.
    if (isSavingRef.current) return;
    axios
      .put(`${API}/flex-events/${currentItem.id}`, {
        FF_time_elapsed: newElapsed,
        // Wall-clock catch-up correction: last_tick_at must advance on every
        // confirmed tick, not just on catch-up, or a later catch-up would
        // double-count time already ticked normally.
        last_tick_at: new Date(now).toISOString(),
      })
      .catch((error) => handleTickUpdateError(error, "Failed to persist flex elapsed time on clock tick"));
  });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedCell, setSelectedCell] = useState(null);
  const [selectedRange, setSelectedRange] = useState({ startCell: null, endCell: null });
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [view, setView] = useState("month");
  const [events, setEvents] = useState([]);
  
  // Panel mode: "idle" | "rigid-config" | "flex-config" | "settings"
  // | "calendar-create" | "calendar-config" (Availability Matrix Phase 4)
  const [panelMode, setPanelMode] = useState("idle");
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [queueWidth, setQueueWidth] = useState(QUEUE_PANEL_DEFAULT_WIDTH);
  const [isDraggingLeftPanel, setIsDraggingLeftPanel] = useState(false);
  const [isDraggingQueuePanel, setIsDraggingQueuePanel] = useState(false);
  const [panelLayoutLoaded, setPanelLayoutLoaded] = useState(false);
  // Availability Matrix (Phase 1 — UI shell). A single 2×2 coordinate,
  // chosen once for the whole calendar list, that decides which one
  // per-calendar availability control each row shows. LAYER: "just-looking"
  // (renders only) vs "tasks-queue" (feeds the engine). KIND: "busy-blocks"
  // (rigid events) vs "availability" (the open-block pattern). Three of the
  // four cells are just a new way to reach the existing eye/wave/intersect
  // toggles — this state does NOT change intersect_calendar_ids /
  // flow_around_calendar_ids or any request the app sends. Persisted
  // alongside the panel layout below.
  const [matrixLayer, setMatrixLayer] = useState("just-looking");
  const [matrixKind, setMatrixKind] = useState("busy-blocks");
  const [showMatrixHelp, setShowMatrixHelp] = useState(false);
  const lastPanelTapRef = useRef({ left: 0, queue: 0 });
  const [isTimezoneModeExpanded, setIsTimezoneModeExpanded] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isCategoryExpanded, setIsCategoryExpanded] = useState(false);
  const [isRepeatExpanded, setIsRepeatExpanded] = useState(false);
  // Event type toggle for idle mode: "rigid" | "flex"
  const [eventTypeToggle, setEventTypeToggle] = useState("rigid");
  
  // Global settings state (persisted to backend)
  const [globalSettings, setGlobalSettings] = useState({
    minDuration: 15,
    timezone: "local",
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    minDuration: "15",
    timezone: "local",
  });
  
  // Backs the dev-mode debug panel and isOpen/isInsideRigid's aging-pause
  // gate (useClock) and placement -- the engine-facing, real
  // flow-around-subtracted result.
  const [openBlocks, setOpenBlocks] = useState(null);

  // Placed flex items state (all items with their fragments)
  const [placedFlexItems, setPlacedFlexItems] = useState([]);
  
  const [editingEvent, setEditingEvent] = useState(null);
  const [rigidEditScope, setRigidEditScope] = useState("series"); // "instance" | "series" | "now-and-future"
  const [rigidSaveError, setRigidSaveError] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    start_time: "",
    end_time: "",
    category: "Work",
    recurrence: "none",
    recurrence_end_date: "",
    days_of_week: [],
    timezone_mode: "absolute",
    home_timezone: null,
  });
  
  // Flex events state
  const [flexEvents, setFlexEvents] = useState([]);
  const [selectedFlexId, setSelectedFlexId] = useState(null);
  const [checkedFlexIds, setCheckedFlexIds] = useState([]);
  const [hoveredFlexId, setHoveredFlexId] = useState(null);
  const tooltipElRef = useRef(null);
  const [editingFlexEvent, setEditingFlexEvent] = useState(null);
  const [isNewFlexItem, setIsNewFlexItem] = useState(false);

  // Calendars state
  const [calendars, setCalendars] = useState([]);
  const [calendarsLoaded, setCalendarsLoaded] = useState(false);
  // Availability Matrix Phase 3 -- eye is tri-state (0 off / 1 blocks-only
  // / 2 full), so grid visibility is keyed per calendar rather than a flat
  // membership array. checkedCalendarIds below is derived from this and
  // kept as the name every other "is this calendar contributing to the
  // grid at all" consumer already reads (Add button's write-access check,
  // getEventsForDate) -- "checked" still correctly means "any non-off
  // state" regardless of detail level.
  const [calendarEyeStates, setCalendarEyeStates] = useState({}); // calendarId -> 0 | 1 | 2
  const checkedCalendarIds = useMemo(
    () => Object.entries(calendarEyeStates).filter(([, s]) => s > 0).map(([id]) => id),
    [calendarEyeStates]
  );
  // "Wave" toggle -- flow around this calendar's rigid events when placing
  // tasks. Live since Prompt 5: only calendars in this list feed
  // get_events_in_range's flow_around_calendar_ids on the backend.
  const [flowAroundCalendarIds, setFlowAroundCalendarIds] = useState([]);
  // "Intersect" toggle -- this calendar's open blocks count toward the
  // engine's intersected availability.
  const [intersectCalendarIds, setIntersectCalendarIds] = useState([]);
  // Per-event calendar membership -- populated only while the rigid event
  // form is open. Distinct from checkedCalendarIds ("eye", grid visibility)
  // and flowAroundCalendarIds ("wave", placement flow-around): this is a
  // selection tied to the event being created/edited, those are global
  // per-calendar toggles.
  const [formCalendarIds, setFormCalendarIds] = useState([]);
  // Remembers the most recent explicit calendar-membership choice made via
  // the checkbox above, so opening a new event defaults to what the user
  // last picked instead of snapping back to the oldest calendar every time.
  const [lastFormCalendarIds, setLastFormCalendarIds] = useState(null);
  const [isCalendarListExpanded, setIsCalendarListExpanded] = useState(false);
  // Availability Matrix Phase 3 -- calendars whose eye button was just
  // clicked while at state 1 with no state 2 to reach (capped by sharing
  // permission). Shows the "you don't have permission..." note alongside
  // the normal 1->0 transition; not a disabled-control affordance, the
  // click always does something real.
  const [eyeNoteCalendarIds, setEyeNoteCalendarIds] = useState(new Set());
  // Canonical open-block rows per calendar (from the server), grouped into
  // units. Re-derived from server rows after every real save (fetch or
  // Save, see handleSaveCalendarConfig) -- what makes a day that diverges
  // on save join/become its own unit, with no special-case code. Staged
  // Calendar Editing: an owner's in-progress edits live in
  // calendarConfigDraft.units instead (this is just where a fresh draft's
  // units are hydrated from); a non-owner's read-only Availability view
  // still reads this directly, since it's never edited.
  const [openBlocksByCalendar, setOpenBlocksByCalendar] = useState({});
  const [openBlocksDraftByCalendar, setOpenBlocksDraftByCalendar] = useState({});
  // Bumped on every successful open-block save, so the aging-pause refetch
  // effect knows to refresh even though the intersect/wave id lists themselves
  // didn't change.
  const [openBlockRowsVersion, setOpenBlockRowsVersion] = useState(0);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [newCalendarColor, setNewCalendarColor] = useState("#3B82F6");
  const [deletingCalendar, setDeletingCalendar] = useState(null);
  const [deleteCalendarError, setDeleteCalendarError] = useState(null);
  // Calendar Sharing feature Phase 2 -- wired to the real access join table.
  // See CalendarSharing.js.
  // Availability Matrix Phase 4 -- which calendar the calendar-config
  // panelMode is showing (was settingsCalendarId, when the gear opened a
  // Dialog instead of a panel). Every other row-level control this phase
  // folds behind the gear (rename, recolor, the inline share form, the
  // open-blocks pencil/expand) reads/writes through this same id now
  // instead of its own per-control Set/id state.
  const [configCalendarId, setConfigCalendarId] = useState(null);
  // Staged Calendar Editing -- calendar-config's draft. Edits below touch
  // only this object; nothing hits the backend until Save. Mirrors the
  // flexForm/originalFlexForm pattern used for task edit (init-on-open,
  // draft-only mutation, explicit Cancel/Save). See the lifecycle effect
  // near renderCalendarConfigPanel for how it's built and discarded.
  const [calendarConfigDraft, setCalendarConfigDraft] = useState(null);
  const originalCalendarConfigDraftRef = useRef(null);
  // Bumped after every calendar-config Save settles (success or partial
  // failure) so CalendarRosterPanel remounts and refetches the real
  // roster -- a failed staged share-add must not linger as an optimistic
  // row once we know it was never actually persisted.
  const [rosterRefreshNonce, setRosterRefreshNonce] = useState(0);
  // Save-in-flight + per-field error messages for calendar-config -- UI
  // feedback only, not part of the draft snapshot itself (so it doesn't
  // get diffed against on the next Save). Reset whenever a fresh draft
  // opens, alongside calendarConfigDraft.
  const [calendarConfigSaveState, setCalendarConfigSaveState] = useState({ saving: false, fieldErrors: {} });
  // Last-one-standing wave guard: prevents unchecking the final calendar
  // still flowing around rigid events. Brief inline message, auto-clears
  // itself after 2s. Shared by both the calendar row's own wave button and
  // calendar-config's staged one, since renderWaveControl serves both.
  const [waveGuardMessage, setWaveGuardMessage] = useState(null); // { calendarId, text } | null
  const waveGuardTimeoutRef = useRef(null);
  const [isAddCalendarChoiceOpen, setIsAddCalendarChoiceOpen] = useState(false); // Import/Create split
  const [isImportListOpen, setIsImportListOpen] = useState(false);
  const [calendarsFetchError, setCalendarsFetchError] = useState(null);
  const [addCalendarError, setAddCalendarError] = useState(null);
  const [addButtonBlockedMessage, setAddButtonBlockedMessage] = useState(false);
  const [flexForm, setFlexForm] = useState({
    name: "",
    duration: "",
  });
  const [originalFlexForm, setOriginalFlexForm] = useState({
    name: "",
    duration: "",
  });
  
  // Drag state for flex queue
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  // Which flex item is currently being click-and-held (dragged) in the queue
  // list, if any -- state (not a ref) so the grey-lock visual re-renders the
  // instant a drag starts, per Priority Phase 3 Part B.
  const [draggingFlexId, setDraggingFlexId] = useState(null);

  // Task Deadlines Part 3 -- cascade warning dialog. Set to
  // { names, onConfirm, onCancel } when a create/edit/drag's candidate
  // check finds newly-affected deadline tasks; null otherwise. onConfirm
  // runs the actual persist (the candidate call itself never persists).
  const [cascadeWarning, setCascadeWarning] = useState(null);
  // Names surfaced by the dialog above also drive a live highlight on the
  // affected queue rows -- separate from lockedFlexIds/deadlineLockedIds,
  // which gate drag legality rather than flag a pending cascade.
  const [cascadeAffectedIds, setCascadeAffectedIds] = useState(new Set());

  // Priority Phase 3 Part B -- grey-lock "focus" derivation. A drag in
  // progress always takes precedence over the open form (holding item B
  // while editing item A must reflect B's priority without touching
  // panelMode). If the dragged item IS the one being edited, its live
  // flexForm.priority is used instead of its stale flexEvents-array value
  // (priority-dropdown changes only update flexForm, never flexEvents --
  // see handleFlexPriorityChange), so the grey-lock never lags what's shown
  // in the open form, and never locks the edited item against itself.
  const focusItemId = draggingFlexId ?? (panelMode === "flex-config" ? selectedFlexId : null);
  let focusPriority = null;
  if (draggingFlexId) {
    const isDraggedItemBeingEdited = panelMode === "flex-config" && draggingFlexId === selectedFlexId;
    focusPriority = isDraggedItemBeingEdited
      ? (flexForm.priority || 3)
      : (flexEvents.find(i => i.id === draggingFlexId)?.priority ?? 3);
  } else if (panelMode === "flex-config") {
    focusPriority = flexForm.priority || 3;
  }
  // Bidirectional: any item in a different tier than the focus item locks --
  // both more important (lower priority number) and less important (higher
  // number). Only same-tier items stay fully interactive.
  const lockedFlexIds = focusPriority == null ? new Set() : new Set(
    flexEvents.filter(item => item.id !== focusItemId && (item.priority ?? 3) !== focusPriority).map(i => i.id)
  );
  // Drag-boundary range (bidirectional), computed directly from priority
  // comparisons rather than lockedFlexIds membership -- that set no longer
  // carries "which side" information now that it locks both directions.
  // lowerBoundaryIndex = one past the last item with priority < focusPriority
  // (dropping before this would place a more-important item below the drag).
  // upperBoundaryIndex = the index of the first item with priority >
  // focusPriority (dropping past this would place a less-important item
  // above the drag). Correct even for an interleaved (non-tier-grouped)
  // array, since either boundary only needs the nearest offending item on
  // its own side. If the starting array is interleaved badly enough to make
  // the two bounds contradict (a more-important item sitting after a
  // less-important one, spanning 3+ tiers), clamp the upper bound up to the
  // lower one -- a single drag can't repair an already-broken multi-tier
  // arrangement in one move, so this defaults toward protecting
  // more-important items.
  let lowerBoundaryIndex = 0;
  let upperBoundaryIndex = flexEvents.length;
  if (focusPriority != null) {
    flexEvents.forEach((item, idx) => {
      if (item.id === focusItemId) return;
      const itemPriority = item.priority ?? 3;
      if (itemPriority < focusPriority) {
        lowerBoundaryIndex = idx + 1;
      } else if (itemPriority > focusPriority && idx < upperBoundaryIndex) {
        upperBoundaryIndex = idx;
      }
    });
    if (upperBoundaryIndex < lowerBoundaryIndex) {
      upperBoundaryIndex = lowerBoundaryIndex;
    }
  }

  // Task Deadlines Part 1 -- deadline grey-lock. Deliberately a separate
  // mechanism from the priority grey-lock above, not merged into it: this
  // one checks each task's *computed* placement (placedFlexItems), not a
  // stored field on the task, and it's one-directional -- only an upper
  // (later) bound, no lower bound, since a deadline only constrains how
  // late the focus task can land, never how early.
  let focusDeadline = null;
  if (draggingFlexId) {
    const isDraggedItemBeingEdited = panelMode === "flex-config" && draggingFlexId === selectedFlexId;
    focusDeadline = isDraggedItemBeingEdited
      ? (flexForm.deadline ? tzLocalToUtcIso(flexForm.deadline, globalSettings.timezone) : null)
      : (flexEvents.find(i => i.id === draggingFlexId)?.deadline ?? null);
  } else if (panelMode === "flex-config") {
    focusDeadline = flexForm.deadline ? tzLocalToUtcIso(flexForm.deadline, globalSettings.timezone) : null;
  }
  const deadlineLockedIds = new Set();
  let deadlineUpperBoundaryIndex = flexEvents.length;
  if (focusDeadline != null) {
    const focusDeadlineTime = new Date(focusDeadline).getTime();
    flexEvents.forEach((item, idx) => {
      if (item.id === focusItemId) return;
      const placedItem = placedFlexItems.find(p => p.flex_event_id === item.id);
      const itemStart = placedItem?.fragments?.[0]?.start_time;
      if (!itemStart) return;
      if (new Date(itemStart).getTime() >= focusDeadlineTime) {
        deadlineLockedIds.add(item.id);
        if (idx < deadlineUpperBoundaryIndex) {
          deadlineUpperBoundaryIndex = idx;
        }
      }
    });
  }

  const isRangeSelectingRef = useRef(false);
  const rangeSelectionMetaRef = useRef(null);
  
  const calendarRef = useRef(null);
  const rigidPanelRef = useRef(null);
  const flexPanelRef = useRef(null);

  // Guards the clock tick from writing FF_time_elapsed to the DB while a
  // handleSaveFlexEvent PUT is in-flight. Without this, a tick that fires
  // during the await can stomp the elapsed = 0 reset we just wrote.
  // useRef (not state) so toggling it never triggers a re-render.
  const isSavingRef = useRef(false);
  // Wall-clock catch-up correction: fires once per app load, not per-render.
  const catchUpDoneRef = useRef(false);
  // In-flight guard for handleSaveFlexEvent -- blocks a second Save click
  // while one is already running, and drives the button's disabled/label
  // state for immediate feedback. State (not a ref) since the button needs
  // to re-render on it. Without this, rapid repeat clicks (no visible
  // feedback while a slow request is pending looked like nothing happened)
  // each fired a fully independent, concurrent create.
  const [isSavingFlexEvent, setIsSavingFlexEvent] = useState(false);

  // Sequence guards for fetchOpenBlocksData/fetchFlexPlacement: a fired-then-
  // superseded request can resolve after a newer one (out-of-order network
  // responses), and without this the stale response's setState wins. Each
  // call stamps the ref with its own id before awaiting; only the call whose
  // id still matches the ref when the response lands is allowed to setState.
  const openBlocksRequestIdRef = useRef(0);
  const flexPlacementRequestIdRef = useRef(0);
  // Same guard for fetchFlexEvents -- previously missing entirely (unlike
  // the three above), which let overlapping fire-and-forget GETs triggered
  // by concurrent creates resolve out of order and silently freeze local
  // queue state below DB truth.
  const flexEventsRequestIdRef = useRef(0);
  // Same guard, per-calendar, used by fetchCalendarOpenBlocks -- guards
  // against an intermittent race where a slow initial fetch could resolve
  // after a local edit and silently revert it. Staged Calendar Editing moved
  // persistence off this same-tick-as-every-edit path onto Save
  // (handleSaveCalendarConfig), which only ever fires once per Save click,
  // so the out-of-order-saves half of the original risk this guarded
  // against no longer applies -- kept for the fetch-vs-edit race, which
  // still can.
  const openBlocksDraftVersionRef = useRef({});
  // Staged Calendar Editing -- monotonic counter for pendingShareActions'
  // temp ids (stageShareAdd), a ref rather than a `let` so it survives
  // re-renders and can't collide across two adds in the same millisecond.
  const tempShareActionSeqRef = useRef(0);

  // Height of each hour row in the day/week views (must stay in sync with CSS)
  const HOUR_SLOT_HEIGHT = 60;
  const MAX_CASCADE_COLUMNS = 6;

  const getEventPositionStyle = (event, cascadeIndex = 0) => {
    const { hours: startH, minutes: startM } = getLocalizedHoursMinutes(event.start_time, globalSettings.timezone, event.timezone_mode, event.home_timezone);
    const { hours: endH, minutes: endM } = getLocalizedHoursMinutes(event.end_time, globalSettings.timezone, event.timezone_mode, event.home_timezone);
    const startMinutes = startH * 60 + startM;
    const rawEndMinutes = endH * 60 + endM;
    const endMinutes = rawEndMinutes <= startMinutes ? rawEndMinutes + 1440 : rawEndMinutes;
    const durationMinutes = Math.max(15, endMinutes - startMinutes);
    const minuteOffset = startMinutes % 60;
    const top = (minuteOffset / 60) * HOUR_SLOT_HEIGHT;
    const height = (durationMinutes / 60) * HOUR_SLOT_HEIGHT;
    const adjustedIndex = Math.min(cascadeIndex, MAX_CASCADE_COLUMNS - 1);
    const cascadeOffset = adjustedIndex * 3;

    return {
      position: "absolute",
      top: `${top + cascadeOffset}px`,
      height: `${height}px`,
      left: "16px",
      width: "calc(100% - 16px)",
      transform: `translateX(${cascadeOffset}px)`,
      overflow: "hidden",
      zIndex: 10 + adjustedIndex,
    };
  };

  const computeCascadeIndexes = (eventsForDay) => {
    const sortedEvents = [...eventsForDay].sort(
      (a, b) => new Date(a.start_time) - new Date(b.start_time)
    );
    const activeEvents = [];
    const indexes = new Map();

    sortedEvents.forEach((event) => {
      const start = new Date(event.start_time);
      const end = new Date(event.end_time);
      for (let i = activeEvents.length - 1; i >= 0; i--) {
        if (new Date(activeEvents[i].end_time) <= start) {
          activeEvents.splice(i, 1);
        }
      }
      const index = activeEvents.length;
      indexes.set(event.id, index);
      activeEvents.push(event);
    });

    return indexes;
  };

  const fetchEvents = useCallback(async () => {
    try {
      let startDate, endDate;
      const timezoneForRange = globalSettings.timezone;
      
      if (view === "month") {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        const visibleStart = startOfWeek(monthStart);
        const visibleEnd = endOfWeek(monthEnd);
        startDate = getTimezoneDayBounds(visibleStart, timezoneForRange).dayStart;
        endDate = getTimezoneDayBounds(visibleEnd, timezoneForRange).dayEnd;
      } else if (view === "week") {
        const visibleStart = startOfWeek(currentDate);
        const visibleEnd = endOfWeek(currentDate);
        startDate = getTimezoneDayBounds(visibleStart, timezoneForRange).dayStart;
        endDate = getTimezoneDayBounds(visibleEnd, timezoneForRange).dayEnd;
      } else {
        const bounds = getTimezoneDayBounds(currentDate, timezoneForRange);
        startDate = bounds.dayStart;
        endDate = bounds.dayEnd;
      }

      const response = await axios.get(`${API}/events`, {
        params: {
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
        },
      });
      setEvents(response.data);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    }
  }, [currentDate, view, globalSettings.timezone]);

  const fetchFlexEvents = useCallback(async () => {
    // Staleness guard (see flexEventsRequestIdRef declaration above) --
    // multiple overlapping calls can be in flight (every handleSaveFlexEvent
    // success fires one, not awaited), and only the response matching the
    // most recently *fired* call is allowed to apply, so an out-of-order
    // response from an earlier, now-superseded call can never overwrite
    // state with a smaller, stale picture of the queue.
    const requestId = ++flexEventsRequestIdRef.current;
    try {
      const response = await axios.get(`${API}/flex-events`);
      if (requestId === flexEventsRequestIdRef.current) {
        setFlexEvents(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch flex events:", error);
    }
  }, []);

  const fetchFlexPlacement = useCallback(async () => {
    console.log("fetchFlexPlacement called");
    const requestId = ++flexPlacementRequestIdRef.current;
    try {
      const timezoneOffset = getTimezoneOffsetMinutes(getEffectiveTimezone(globalSettings.timezone));
      const response = await axios.post(`${API}/flex-placement`, {
        intersect_calendar_ids: intersectCalendarIds,
        flow_around_calendar_ids: flowAroundCalendarIds,
        timezone_offset: timezoneOffset,
        min_duration: globalSettings.minDuration,
      });
      console.log("Flex placement response:", response.data);
      if (requestId !== flexPlacementRequestIdRef.current) return;
      setPlacedFlexItems(response.data.placed_items || []);
    } catch (error) {
      console.error("Failed to fetch flex placement:", error);
      if (requestId !== flexPlacementRequestIdRef.current) return;
      setPlacedFlexItems([]);
    }
  }, [globalSettings, intersectCalendarIds, flowAroundCalendarIds]);

  // Task Deadlines Part 3: preview a hypothetical queue (create/edit/drag,
  // at its proposed position/duration/priority/deadline) against the
  // candidate endpoint and diff it against the currently-held
  // placedFlexItems baseline for every deadline-bearing task in the
  // hypothetical list. Returns the names of tasks newly affected (were
  // meeting their deadline or didn't exist yet, now missing it) -- a
  // pre-existing violation never counts as newly affected. Never persists
  // anything; a network failure here fails open (no dialog) rather than
  // blocking the edit, matching this codebase's existing
  // console.error-and-continue convention for preview/derived data.
  const checkDeadlineCascade = useCallback(async (candidateItems) => {
    try {
      const timezoneOffset = getTimezoneOffsetMinutes(getEffectiveTimezone(globalSettings.timezone));
      const response = await axios.post(`${API}/flex-placement/candidate`, {
        intersect_calendar_ids: intersectCalendarIds,
        flow_around_calendar_ids: flowAroundCalendarIds,
        timezone_offset: timezoneOffset,
        min_duration: globalSettings.minDuration,
        candidate_items: candidateItems,
      });
      const baselineById = new Map(placedFlexItems.map(p => [p.flex_event_id, p]));
      const candidateById = new Map((response.data.placed_items || []).map(p => [p.flex_event_id, p]));
      const affected = [];
      for (const item of candidateItems) {
        if (!item.deadline) continue;
        const baseline = baselineById.get(item.id);
        const candidate = candidateById.get(item.id);
        const wasOk = !baseline || baseline.insufficient_time !== true;
        const nowBad = !!candidate && candidate.insufficient_time === true;
        if (wasOk && nowBad) {
          affected.push({ id: item.id, name: item.name });
        }
      }
      return affected;
    } catch (error) {
      console.error("Failed to check deadline cascade:", error);
      return [];
    }
  }, [globalSettings, intersectCalendarIds, flowAroundCalendarIds, placedFlexItems]);

  // Fetch persisted global settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/settings`);
      const s = response.data;
      setGlobalSettings({
        minDuration: s.min_duration,
        timezone: s.timezone,
      });
      setSettingsLoaded(true);
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      setSettingsLoaded(true);
    }
  }, []);

  // Core /open-blocks fetch. This feeds the aging-pause isOpen
  // check in useClock above (and the dev debug panel's "View Open Blocks"
  // button) and must never see an unsaved calendar-config edit -- plain
  // intersectCalendarIds/flowAroundCalendarIds, nothing else, mirroring
  // fetchFlexPlacement's own inputs above.
  const fetchOpenBlocksData = useCallback(async () => {
    const requestId = ++openBlocksRequestIdRef.current;
    const timezoneOffset = getTimezoneOffsetMinutes(getEffectiveTimezone(globalSettings.timezone));
    const response = await axios.post(`${API}/open-blocks`, {
      intersect_calendar_ids: intersectCalendarIds,
      flow_around_calendar_ids: flowAroundCalendarIds,
      timezone_offset: timezoneOffset,
    });
    if (requestId === openBlocksRequestIdRef.current) {
      setOpenBlocks(response.data);
    }
    return response.data;
  }, [intersectCalendarIds, flowAroundCalendarIds, globalSettings.timezone]);

  // Fetch the user's calendars. eye/wave/intersect now come back
  // per-calendar from the backend (Availability Matrix Phase 2) and are
  // mirrored into their own id-array states by the effect above -- no local
  // seeding here anymore.
  const fetchCalendars = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/calendars`);
      const fetchedCalendars = response.data || [];
      setCalendars(fetchedCalendars);
      setCalendarsLoaded(true);
      setCalendarsFetchError(null);
    } catch (error) {
      console.error("Failed to fetch calendars:", error);
      setCalendarsLoaded(true);
      setCalendarsFetchError(error.response?.data?.detail || "Failed to load calendars");
    }
  }, []);

  const createCalendar = useCallback(async (name, color) => {
    try {
      // Availability Matrix Phase 4 -- the create panel transitions
      // straight into calendar-config for the new calendar, so the
      // caller needs its id back, not just a bare ok.
      const response = await axios.post(`${API}/calendars`, { name, color });
      await fetchCalendars();
      return { ok: true, calendar: response.data };
    } catch (error) {
      console.error("Failed to create calendar:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to create calendar" };
    }
  }, [fetchCalendars]);

  const updateCalendar = useCallback(async (calendarId, updates) => {
    try {
      await axios.patch(`${API}/calendars/${calendarId}`, updates);
      await fetchCalendars();
      return { ok: true };
    } catch (error) {
      console.error("Failed to update calendar:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to update calendar" };
    }
  }, [fetchCalendars]);

  const deleteCalendar = useCallback(async (calendarId) => {
    try {
      await axios.delete(`${API}/calendars/${calendarId}`);
      setCalendarEyeStates((prev) => {
        const next = { ...prev };
        delete next[calendarId];
        return next;
      });
      await fetchCalendars();
      // Orphaned events are deleted server-side and shared ones lose a
      // calendar_ids entry -- refetch so the grid reflects both without a
      // stale reload.
      await fetchEvents();
      return { ok: true };
    } catch (error) {
      console.error("Failed to delete calendar:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to delete calendar" };
    }
  }, [fetchCalendars, fetchEvents]);

  // Calendar Sharing feature Phase 2 -- API wiring passed into
  // CalendarSharing.js's components, which stay free of axios/API-constant
  // coupling themselves.
  const shareCalendarWithUser = useCallback(async (calendarId, { email, permission, detail }) => {
    try {
      const response = await axios.post(`${API}/calendars/${calendarId}/share`, {
        email,
        permission_level: permission,
        detail_level: detail,
      });
      return { ok: true, access: response.data };
    } catch (error) {
      console.error("Failed to share calendar:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to share calendar" };
    }
  }, []);

  // Calendar Sharing feature Phase 3b -- resends the invite email on a
  // share's existing token (no rotation). Distinguishes a cooldown 429
  // (server-side throttle) from a genuine failure so the roster row can
  // show a countdown instead of a generic error for the former.
  const resendShareInvite = useCallback(async (calendarId, accessId) => {
    try {
      const response = await axios.post(`${API}/calendars/${calendarId}/access/${accessId}/resend-invite`);
      return { ok: true, emailSent: response.data.email_sent };
    } catch (error) {
      if (error.response?.status === 429) {
        return { ok: false, cooldown: true, retryAfterSeconds: error.response.data?.detail?.retry_after_seconds || 0 };
      }
      console.error("Failed to resend invite:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to resend invite" };
    }
  }, []);

  const fetchCalendarRoster = useCallback(async (calendarId) => {
    try {
      const response = await axios.get(`${API}/calendars/${calendarId}/access`);
      return { ok: true, roster: response.data || [] };
    } catch (error) {
      console.error("Failed to fetch calendar roster:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to load who has access" };
    }
  }, []);

  // Owner revoking someone else's access from the roster panel -- the
  // owner's own calendar list is unaffected, so no refetch needed here.
  const removeCalendarAccess = useCallback(async (calendarId, accessId) => {
    try {
      await axios.delete(`${API}/calendars/${calendarId}/access/${accessId}`);
      return { ok: true };
    } catch (error) {
      console.error("Failed to remove calendar access:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to remove access" };
    }
  }, []);

  // Recipient leaving a calendar shared with them -- same DELETE endpoint as
  // removeCalendarAccess above (deleting your own access row), but the
  // calendar disappears from the leaving user's own list, so this refetches
  // like deleteCalendar does.
  const leaveSharedCalendar = useCallback(async (calendarId, accessId) => {
    try {
      await axios.delete(`${API}/calendars/${calendarId}/access/${accessId}`);
      setCalendarEyeStates((prev) => {
        const next = { ...prev };
        delete next[calendarId];
        return next;
      });
      await fetchCalendars();
      await fetchEvents();
      return { ok: true };
    } catch (error) {
      console.error("Failed to leave shared calendar:", error);
      return { ok: false, message: error.response?.data?.detail || "Failed to remove this calendar" };
    }
  }, [fetchCalendars, fetchEvents]);

  // Staged Calendar Editing -- these four replace shareCalendarWithUser/
  // removeCalendarAccess as the onShare/onRemove props passed into
  // CalendarRosterPanel while calendar-config is open. Nothing here hits
  // the network; the real POST/DELETE calls happen from
  // handleSaveCalendarConfig. CalendarRosterPanel already updates its own
  // local roster state optimistically from whatever these return
  // (CalendarSharing.js's handleAddRecipient/handleRemove), so a synthetic
  // { ok: true, ... } result is enough to reuse it unmodified for the
  // pending case.
  const stageShareAdd = (calendarId, { email, permission, detail }) => {
    const tempId = `pending-share-${Date.now()}-${++tempShareActionSeqRef.current}`;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const action = {
        id: tempId, type: "add",
        payload: { email, permission, detail },
        status: "pending", error: null,
      };
      return { ...prev, pendingShareActions: [...(prev.pendingShareActions || []), action] };
    });
    return Promise.resolve({
      ok: true,
      access: {
        id: tempId, email, permission_level: permission, detail_level: detail,
        has_account: false, feed_url: "", created_at: new Date().toISOString(),
        email_sent: null, __pending: true,
      },
    });
  };

  const stageShareRemove = (calendarId, accessId) => {
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const isTempAdd = (prev.pendingShareActions || []).some((a) => a.id === accessId && a.type === "add");
      if (isTempAdd) {
        // Never became a real request -- just drop the queued add.
        return { ...prev, pendingShareActions: prev.pendingShareActions.filter((a) => a.id !== accessId) };
      }
      const action = {
        id: `pending-remove-${accessId}`, type: "remove",
        payload: { accessId }, status: "pending", error: null,
      };
      return { ...prev, pendingShareActions: [...(prev.pendingShareActions || []), action] };
    });
    return Promise.resolve({ ok: true });
  };

  // A failed add is not left for a blind resend -- an invalid-email (or
  // other validation) failure fails the exact same way on an unmodified
  // retry. editShareAction writes into the *same* queue entry (not a new
  // one) and clears status/error so the next Save retries with the
  // corrected value; discardShareAction drops it entirely, separate from
  // editing, since the user may decide not to invite that person at all.
  const editShareAction = (actionId, email) => {
    setCalendarConfigDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pendingShareActions: (prev.pendingShareActions || []).map((a) =>
          a.id === actionId ? { ...a, payload: { ...a.payload, email }, status: "pending", error: null } : a
        ),
      };
    });
  };

  const discardShareAction = (actionId) => {
    setCalendarConfigDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, pendingShareActions: (prev.pendingShareActions || []).filter((a) => a.id !== actionId) };
    });
  };

  // hasNewShares badge -- no server-side "unread" column (decision 2 keeps
  // the access join table free of status columns), so "new" is derived
  // client-side by comparing shared calendars' access_created_at against a
  // last-viewed timestamp. That timestamp is namespaced per user id in
  // localStorage rather than a bare key -- a bare key previously leaked
  // this state across accounts on a shared browser; namespacing avoids
  // repeating that.
  const sharedCalendars = useMemo(() => calendars.filter((cal) => !cal.is_owner), [calendars]);
  // Only owned calendars count toward the "last remaining calendar" guard
  // -- matches the backend's delete_calendar check, which counts
  // CalendarModel rows by owner and never includes shared-in calendars.
  // Used by both the delete confirmation flow and (Availability Matrix
  // Phase 4) the calendar-config panel's Delete section.
  const ownedCalendarCount = useMemo(() => calendars.filter((c) => c.is_owner).length, [calendars]);
  const sharesLastViewedKey = session?.user?.id ? `flexflow_shares_last_viewed_${session.user.id}` : null;
  // Mirrors localStorage as real state (rather than reading it imperatively
  // inside a memo) so hasNewShares recomputes on a normal React dependency
  // instead of needing a synthetic "force recompute" version counter.
  const [sharesLastViewedAt, setSharesLastViewedAt] = useState(null);
  useEffect(() => {
    setSharesLastViewedAt(sharesLastViewedKey ? localStorage.getItem(sharesLastViewedKey) : null);
  }, [sharesLastViewedKey]);

  const hasNewShares = useMemo(() => {
    const latestShareAt = sharedCalendars.reduce(
      (max, cal) => (cal.access_created_at && cal.access_created_at > max ? cal.access_created_at : max),
      ""
    );
    if (!latestShareAt) return false;
    return !sharesLastViewedAt || latestShareAt > sharesLastViewedAt;
  }, [sharedCalendars, sharesLastViewedAt]);

  // Acks whenever the shared-calendars list is opened, regardless of entry
  // point (profile menu's Messages -> Shared calendars, or "+ Add Calendar"
  // -> Import) -- both open the same isImportListOpen dialog.
  useEffect(() => {
    if (isImportListOpen && sharesLastViewedKey) {
      const now = new Date().toISOString();
      localStorage.setItem(sharesLastViewedKey, now);
      setSharesLastViewedAt(now);
    }
  }, [isImportListOpen, sharesLastViewedKey]);

  // Calendar Sharing feature Phase 2: real per-calendar write-permission
  // check, replacing the old always-true stub. `is_owner`/`permission_level`
  // come straight from GET /calendars.
  const canWriteCalendar = (cal) => cal.is_owner || cal.permission_level === "write";

  // Availability Matrix Phase 3 -- the highest eye state this viewer's
  // sharing permission allows for this calendar: 2 (full, titled and
  // clickable) if they own it, have write access, or were given a
  // full-detail read share; else 1 (blocks-only). Mirrors the backend's
  // single-calendar reduction of its own detail-level rule using fields
  // GET /calendars already returns -- no new API field needed.
  const calendarEyeCap = (cal) =>
    (cal.is_owner || cal.permission_level === "write" || cal.detail_level === "full") ? 2 : 1;

  // Availability Matrix Phase 2: eye/wave/intersect are now
  // backend-persisted per (viewer, calendar), which already applies the
  // actual default rule (all on for the account's own oldest calendar, eye-only for
  // every other calendar, owned or shared). The frontend no longer computes
  // any default itself; it just mirrors whatever GET /calendars says
  // whenever the calendar list changes. Each toggle's own onClick still
  // does an optimistic local update on top of this (see
  // renderCalendarMatrixControl), so this effect only matters on load and
  // after a calendar create/delete refetch, not on every click.
  useEffect(() => {
    setCalendarEyeStates(Object.fromEntries(calendars.map((cal) => [cal.id, cal.eye])));
    setFlowAroundCalendarIds(calendars.filter((cal) => cal.wave).map((cal) => cal.id));
    setIntersectCalendarIds(calendars.filter((cal) => cal.intersect).map((cal) => cal.id));
  }, [calendars]);

  // Open-blocks editor: server rows <-> edit-time "units" (one unit per
  // distinct start/end time range, days grouped onto it). Grouping after
  // every save is what makes a day that diverges on save join/become its
  // own unit, with no special-case code.
  function groupRowsIntoUnits(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = `${row.start_time}|${row.end_time}`;
      if (!map.has(key)) {
        map.set(key, { start_time: row.start_time, end_time: row.end_time, days: [false, false, false, false, false, false, false] });
      }
      map.get(key).days[row.day_of_week] = true;
    }
    return Array.from(map.values()).sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  function flattenUnitsToRows(units) {
    const rows = [];
    for (const unit of units) {
      unit.days.forEach((checked, dayIdx) => {
        if (checked) rows.push({ day_of_week: dayIdx, start_time: unit.start_time, end_time: unit.end_time });
      });
    }
    return rows;
  }

  // Snaps a "HH:MM" time string by wholeHours, clamped to the same day --
  // open-block units are day-of-week scoped and never cross midnight, unlike
  // the datetime-local rigid event form's start/end guard this mirrors
  // (App.js ~3204-3243), which can roll over to the next calendar day.
  function addHoursToTimeString(timeStr, wholeHours) {
    const [h, m] = timeStr.split(":").map(Number);
    const clampedMinutes = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + wholeHours * 60));
    return `${String(Math.floor(clampedMinutes / 60)).padStart(2, "0")}:${String(clampedMinutes % 60).padStart(2, "0")}`;
  }

  const fetchCalendarOpenBlocks = useCallback(async (calendarId) => {
    const requestVersion = (openBlocksDraftVersionRef.current[calendarId] || 0) + 1;
    openBlocksDraftVersionRef.current[calendarId] = requestVersion;
    try {
      const response = await axios.get(`${API}/calendars/${calendarId}/open-blocks`);
      // Superseded by a newer fetch or a save that started after this one --
      // discard rather than reverting the user's more recent state.
      if (openBlocksDraftVersionRef.current[calendarId] !== requestVersion) return;
      const rows = response.data.blocks;
      setOpenBlocksByCalendar((prev) => ({ ...prev, [calendarId]: rows }));
      setOpenBlocksDraftByCalendar((prev) => ({ ...prev, [calendarId]: groupRowsIntoUnits(rows) }));
    } catch (error) {
      console.error("Failed to fetch calendar open blocks:", error);
    }
  }, []);

  // Availability Matrix Phase 4 -- calendar-config is single-calendar-scoped
  // (configCalendarId), so there's no more per-calendar "expanded" set to
  // gate the fetch on; fetch once whenever the panel opens for a calendar
  // whose open blocks aren't cached yet (was toggleEditOpenBlocks's
  // fetch-on-first-expand branch).
  useEffect(() => {
    if (configCalendarId && !openBlocksByCalendar[configCalendarId]) {
      fetchCalendarOpenBlocks(configCalendarId);
    }
  }, [configCalendarId, openBlocksByCalendar, fetchCalendarOpenBlocks]);

  // Guards against a dangling configCalendarId -- e.g. the calendar shown
  // in calendar-config was just deleted from inside that same panel.
  // renderCalendarConfigPanel already no-ops on a missing calendar, but
  // without this the panel would just go blank instead of returning to idle.
  useEffect(() => {
    if (panelMode === "calendar-config" && configCalendarId && !calendars.some((c) => c.id === configCalendarId)) {
      setPanelMode("idle");
      setConfigCalendarId(null);
    }
  }, [panelMode, configCalendarId, calendars]);

  // Staged Calendar Editing -- builds calendarConfigDraft from currently
  // persisted state. `units` is deliberately left empty here and filled in
  // by the hydration effect below, since open-blocks rows may not be
  // cached yet (fetchCalendarOpenBlocks, above, is async on a cache miss).
  const buildCalendarConfigDraft = (calendarId) => {
    const cal = calendars.find((c) => c.id === calendarId);
    if (!cal) return null;
    return {
      name: cal.name,
      color: cal.color || DEFAULT_CALENDAR_COLOR,
      eye: calendarEyeStates[calendarId] ?? 0,
      wave: flowAroundCalendarIds.includes(calendarId),
      intersect: intersectCalendarIds.includes(calendarId),
      units: [],
      pendingShareActions: [],
    };
  };

  // Single lifecycle effect for the whole draft: builds a fresh one whenever
  // calendar-config becomes active for some calendarId, discards it (sets
  // null) on every other transition -- idle, any other panelMode, sign-out,
  // the dangling-calendar guard above, or switching straight to a different
  // calendar's gear. That covers every existing away-transition with no
  // per-site handling: closing the panel always means "discard," and
  // nothing here was ever sent to the backend, so there's nothing to undo.
  useEffect(() => {
    if (panelMode === "calendar-config" && configCalendarId) {
      const draft = buildCalendarConfigDraft(configCalendarId);
      setCalendarConfigDraft(draft);
      originalCalendarConfigDraftRef.current = draft;
    } else {
      setCalendarConfigDraft(null);
      originalCalendarConfigDraftRef.current = null;
    }
    setCalendarConfigSaveState({ saving: false, fieldErrors: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode, configCalendarId]);

  // Fills calendarConfigDraft.units in once open-blocks rows are available
  // for configCalendarId -- fires at most once per draft session (guarded
  // by unitsHydratedRef, reset whenever a fresh draft opens above), so a
  // fetch that resolves after the user has already started editing units
  // never stomps their edit. Keeps originalCalendarConfigDraftRef in sync
  // too, so Save's diff doesn't mistake "just hydrated" for "user changed
  // it" and fire a needless PUT /open-blocks.
  const unitsHydratedRef = useRef(false);
  useEffect(() => {
    unitsHydratedRef.current = false;
  }, [panelMode, configCalendarId]);
  useEffect(() => {
    if (
      panelMode === "calendar-config" && configCalendarId &&
      !unitsHydratedRef.current && openBlocksDraftByCalendar[configCalendarId]
    ) {
      unitsHydratedRef.current = true;
      const units = openBlocksDraftByCalendar[configCalendarId];
      setCalendarConfigDraft((prev) => (prev ? { ...prev, units } : prev));
      if (originalCalendarConfigDraftRef.current) {
        originalCalendarConfigDraftRef.current = { ...originalCalendarConfigDraftRef.current, units };
      }
    }
  }, [panelMode, configCalendarId, openBlocksDraftByCalendar]);

  // Staged Calendar Editing -- the five handlers below mutate
  // calendarConfigDraft.units only; nothing here persists to the backend
  // anymore, that moves entirely to handleSaveCalendarConfig. The calendarId
  // param is kept for call-site parity with the JSX (and as a safety no-op
  // guard) even though there's only ever one active draft at a time.
  //
  // Each one also locks unitsHydratedRef -- fetchCalendarOpenBlocks's GET
  // (fired on a cache miss when the panel opens) is async, and without
  // this a fetch still in flight when the user starts editing could
  // resolve afterward and silently wipe the unsaved unit back to the
  // server's still-empty state, via the hydration effect above. Same race,
  // same fix shape as Phase 4's original handleAddUnit/
  // openBlocksDraftVersionRef bug -- once the
  // user has touched the editor at all, the fetch's answer is stale by
  // definition and must never overwrite the draft again.
  const handleAddUnit = (calendarId) => {
    unitsHydratedRef.current = true;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const units = [...(prev.units || []), { start_time: "09:00", end_time: "17:00", days: [false, false, false, false, false, false, false] }];
      return { ...prev, units };
    });
  };

  const handleDeleteUnit = (calendarId, unitIndex) => {
    unitsHydratedRef.current = true;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const units = (prev.units || []).filter((_, i) => i !== unitIndex);
      return { ...prev, units };
    });
  };

  const handleToggleUnitDay = (calendarId, unitIndex, dayIndex) => {
    unitsHydratedRef.current = true;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const units = (prev.units || []).map((u, i) =>
        i === unitIndex ? { ...u, days: u.days.map((d, di) => (di === dayIndex ? !d : d)) } : u
      );
      return { ...prev, units };
    });
  };

  const handleUnitTimeChange = (calendarId, unitIndex, field, value) => {
    unitsHydratedRef.current = true;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const units = (prev.units || []).map((u, i) => (i === unitIndex ? { ...u, [field]: value } : u));
      return { ...prev, units };
    });
  };

  // Same start/end guardrail as the rigid event form's Start/End onBlur
  // handlers (App.js ~3204-3243): editing one boundary past the other snaps
  // the other boundary 1 hour away instead of silently accepting (and having
  // the backend reject) an invalid range. Pure client-side computation --
  // unaffected by persistence moving to Save.
  const handleUnitTimeBlur = (calendarId, unitIndex, field) => {
    unitsHydratedRef.current = true;
    setCalendarConfigDraft((prev) => {
      if (!prev || calendarId !== configCalendarId) return prev;
      const units = prev.units || [];
      const unit = units[unitIndex];
      if (!unit) return prev;

      let nextUnit = unit;
      if (field === "start_time") {
        if (!unit.end_time || unit.start_time >= unit.end_time) {
          nextUnit = { ...unit, end_time: addHoursToTimeString(unit.start_time, 1) };
        }
      } else if (field === "end_time") {
        if (unit.end_time && unit.start_time && unit.end_time <= unit.start_time) {
          nextUnit = { ...unit, start_time: addHoursToTimeString(unit.end_time, -1) };
        }
      }

      if (nextUnit === unit) return prev;
      const nextUnits = units.map((u, i) => (i === unitIndex ? nextUnit : u));
      return { ...prev, units: nextUnits };
    });
  };

  useEffect(() => {
    const inRecovery = { current: false };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        inRecovery.current = true;
        setSession("PASSWORD_RECOVERY");
      } else if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && inRecovery.current) {
        // suppress SIGNED_IN and INITIAL_SESSION that Supabase fires immediately after PASSWORD_RECOVERY
      } else {
        inRecovery.current = false;
        if (event === "SIGNED_OUT") {
          // App never unmounts across sign-out -- it just conditionally
          // renders AuthScreen -- so panel mode and any in-progress form
          // drafts would otherwise sit in memory and reappear on the next
          // sign-in. Discard them here rather than special-casing sign-in.
          setPanelMode("idle");
          resetEventForm();
          resetFlexForm();
          setConfigCalendarId(null);
          setOpenBlocksDraftByCalendar({});
        }
        setSession(session);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchSettings();
  }, [fetchSettings, session]);

  useEffect(() => {
    try {
      const rawLayout = window.localStorage.getItem(PANEL_LAYOUT_KEY);
      if (rawLayout) {
        const savedLayout = JSON.parse(rawLayout);
        if (typeof savedLayout.leftPanelWidth === "number" && savedLayout.leftPanelWidth >= LEFT_PANEL_MIN_WIDTH && savedLayout.leftPanelWidth <= LEFT_PANEL_MAX_WIDTH) {
          setLeftPanelWidth(savedLayout.leftPanelWidth);
        }
        if (typeof savedLayout.isLeftPanelCollapsed === "boolean") {
          setIsLeftPanelCollapsed(savedLayout.isLeftPanelCollapsed);
        }
        if (typeof savedLayout.queueWidth === "number" && savedLayout.queueWidth >= QUEUE_PANEL_MIN_WIDTH && savedLayout.queueWidth <= QUEUE_PANEL_MAX_WIDTH) {
          setQueueWidth(savedLayout.queueWidth);
        }
        if (typeof savedLayout.isQueueCollapsed === "boolean") {
          setIsQueueCollapsed(savedLayout.isQueueCollapsed);
        }
        if (savedLayout.matrixLayer === "just-looking" || savedLayout.matrixLayer === "tasks-queue") {
          setMatrixLayer(savedLayout.matrixLayer);
        }
        if (savedLayout.matrixKind === "busy-blocks" || savedLayout.matrixKind === "availability") {
          setMatrixKind(savedLayout.matrixKind);
        }
      }
    } catch (error) {
      console.error("Failed to load panel layout preferences:", error);
    } finally {
      setPanelLayoutLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchEvents();
  }, [fetchEvents, session]);

  useEffect(() => {
    if (!session) return;
    fetchFlexEvents();
  }, [fetchFlexEvents, session]);

  useEffect(() => {
    if (!session) return;
    fetchCalendars();
  }, [fetchCalendars, session]);

  // Keeps openBlocks fresh for the aging-pause tick in useClock above.
  // fetchOpenBlocksData's own identity already changes when
  // intersectCalendarIds/flowAroundCalendarIds change, so this refires on
  // the intersect toggle, the wave toggle, calendar add/remove, and any
  // saved open-block-row edit (openBlockRowsVersion) -- not on a timer, not
  // per-tick.
  useEffect(() => {
    if (!settingsLoaded || !calendarsLoaded) return;
    fetchOpenBlocksData().catch((error) => console.error("Failed to refresh open blocks for aging pause:", error));
  }, [fetchOpenBlocksData, calendars, openBlockRowsVersion, settingsLoaded, calendarsLoaded]);

  // Wall-clock aging catch-up (Priority Phase 3 correction): once per load,
  // for the item that's actually going to age (lowest priority,position --
  // same selection as the useClock tick above), ask the backend to
  // integrate real elapsed time since its last confirmed tick through the
  // same open-block/rigid-event pause semantics the live tick uses. Without
  // this, closing the tab freezes progress at whatever was last saved.
  useEffect(() => {
    if (!settingsLoaded || !calendarsLoaded) return;
    if (catchUpDoneRef.current) return;
    if (flexEvents.length === 0) return;
    // intersectCalendarIds/flowAroundCalendarIds populate via a separate,
    // later-firing effect keyed on `calendars` -- wait for at least one of
    // them to be non-empty so this doesn't fire on a render where they're
    // still their initial []; an empty intersect list makes the backend
    // treat the whole elapsed range as closed (0 seconds credited).
    if (intersectCalendarIds.length === 0 && flowAroundCalendarIds.length === 0) return;
    const activeItem = [...flexEvents].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))[0];
    if (activeItem.isTemp || activeItem.completed) return;
    catchUpDoneRef.current = true;
    const timezoneOffset = getTimezoneOffsetMinutes(getEffectiveTimezone(globalSettings.timezone));
    axios.post(`${API}/flex-events/${activeItem.id}/catch-up`, {
      intersect_calendar_ids: intersectCalendarIds,
      flow_around_calendar_ids: flowAroundCalendarIds,
      timezone_offset: timezoneOffset,
    })
      // Merge, not the plain overwrite fetchFlexEvents() does everywhere
      // else: this fetch is asynchronous and can resolve well after the
      // user has started (but not yet saved) a new task -- a full
      // overwrite from server truth would silently drop that unsaved
      // isTemp entry, since it has no server row to be reflected in the
      // response at all. Every other flexEvents entry has a real server
      // row, so re-fetching and taking the server's version for those is
      // exactly what already happens today; only the isTemp carve-out is
      // new here. Appended at the end, matching where a new task always
      // starts (openNewFlexEventPanel never inserts elsewhere).
      .then(() => axios.get(`${API}/flex-events`))
      .then((response) => {
        setFlexEvents(prev => {
          const localOnly = prev.filter(e => e.isTemp);
          return localOnly.length > 0 ? [...response.data, ...localOnly] : response.data;
        });
      })
      .catch((error) => console.error("Failed to catch up flex event aging:", error));
  }, [settingsLoaded, calendarsLoaded, flexEvents, intersectCalendarIds, flowAroundCalendarIds, globalSettings.timezone]);

  useEffect(() => {
    if (!panelLayoutLoaded) return;

    try {
      window.localStorage.setItem(
        PANEL_LAYOUT_KEY,
        JSON.stringify({
          leftPanelWidth,
          isLeftPanelCollapsed,
          queueWidth,
          isQueueCollapsed,
          matrixLayer,
          matrixKind,
        })
      );
    } catch (error) {
      console.error("Failed to save panel layout preferences:", error);
    }
  }, [leftPanelWidth, isLeftPanelCollapsed, queueWidth, isQueueCollapsed, matrixLayer, matrixKind, panelLayoutLoaded]);

  useEffect(() => {
    // selectedEventId/selectedFlexId are included (not just panelMode) so
    // switching from one item's panel straight to a different item's --
    // without ever passing through "idle" -- re-focuses the panel too.
    // panelMode alone doesn't change on that kind of switch, so the effect
    // wouldn't otherwise re-run: focus stayed wherever the queue-item/
    // calendar-event click left it (nowhere useful, since those aren't
    // focusable), and the panel's onKeyDown-gated keyboard Delete shortcut
    // silently stopped working after a switch (bug found 2026-09-05; a
    // direct click on the Delete button was unaffected, since clicks don't
    // depend on focus).
    if (panelMode === "rigid-config") {
      rigidPanelRef.current?.focus();
    } else if (panelMode === "flex-config") {
      flexPanelRef.current?.focus();
    }
  }, [panelMode, selectedEventId, selectedFlexId]);

  useEffect(() => {
    setCheckedFlexIds((prev) => prev.filter((id) => flexEvents.some((item) => item.id === id)));
  }, [flexEvents]);

  // Fetch flex placement when flex events, rigid events, or settings change
  // Only consider real flex events (not temp items)
  // Re-runs when rigid events change so flex items avoid conflicts
  //
  // openBlockRowsVersion is included so an availability-schedule edit is its
  // own direct trigger -- when the global schedule changes, the flex engine
  // re-places from the top of the queue. Before this, a schedule
  // edit had no trigger of its own; a re-placement only happened as an
  // incidental side effect of the aging tick's isOpen pause-gate (useClock
  // above) flipping closed->open, which only reliably happens when a change
  // makes an earlier moment newly open, not a later one. fetchFlexPlacement
  // itself already depends on intersectCalendarIds/flowAroundCalendarIds, so
  // toggling wave/intersect was already covered; this closes the gap for
  // editing an already-enabled calendar's open-block times.
  useEffect(() => {
    if (!settingsLoaded) return;
    // Freeze placement refetches while the flex-config panel is open. Nothing
    // acts on the schedule until the panel closes, so the per-second
    // refetches this effect would otherwise fire (driven by the useClock
    // aging tick's setFlexEvents, and by name-field keystrokes) would only
    // feed the deadline grey-lock inconsistent, wall-clock-drifting inputs:
    // the engine re-anchors to datetime.now() every call, so task spans
    // drift underneath the frozen deadline calculation while the panel is
    // open.
    // `panelMode` is a dep so leaving flex-config (via any close path) re-runs
    // this and catches the schedule up against the current `now` and the
    // fully-aged FF_time_elapsed (useClock keeps PUTing elapsed to the DB
    // throughout the freeze). Opening a non-flex-config panel also re-runs it
    // -- one redundant, idempotent /flex-placement call, no behaviour change.
    if (panelMode === "flex-config") return;
    const realFlexEvents = flexEvents.filter(e => !e.isTemp);
    console.log("Recalculating flex placement. Flex events:", realFlexEvents.length, "Rigid events:", events.length);
    if (realFlexEvents.length > 0) {
      fetchFlexPlacement();
    } else {
      setPlacedFlexItems([]);
    }
  }, [flexEvents, events, fetchFlexPlacement, settingsLoaded, openBlockRowsVersion, panelMode]);

  const handlePrevious = () => {
    if (view === "month") {
      setCurrentDate(subMonths(currentDate, 1));
    } else if (view === "week") {
      setCurrentDate(subWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, -1));
    }
  };

  const handleNext = () => {
    if (view === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else if (view === "week") {
      setCurrentDate(addWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const PANEL_TAP_MOVE_THRESHOLD = 4; // px -- above this, a touch is a drag, not a tap
  const PANEL_DOUBLE_TAP_WINDOW = 300; // ms between touchends to count as a double-tap

  // Shared drag-to-resize + double-tap-to-collapse for the left-panel and
  // flex-queue grip handles. Mouse double-click is handled separately via
  // each button's native onDoubleClick -- touch devices don't reliably
  // synthesize dblclick from two taps, so double-tap is tracked here by
  // hand (two touchends on the same handle within PANEL_DOUBLE_TAP_WINDOW,
  // neither of which moved past the tap threshold).
  const startPanelInteraction = (e, panel) => {
    const isTouch = e.type === "touchstart";
    if (!isTouch && e.button !== 0) return;

    const isLeft = panel === "left";
    const collapsed = isLeft ? isLeftPanelCollapsed : isQueueCollapsed;
    const point = isTouch ? e.touches[0] : e;
    const startX = point.clientX;
    const startWidth = isLeft ? leftPanelWidth : queueWidth;
    const minWidth = isLeft ? LEFT_PANEL_MIN_WIDTH : QUEUE_PANEL_MIN_WIDTH;
    const maxWidth = isLeft ? LEFT_PANEL_MAX_WIDTH : QUEUE_PANEL_MAX_WIDTH;
    const setWidth = isLeft ? setLeftPanelWidth : setQueueWidth;
    const setDragging = isLeft ? setIsDraggingLeftPanel : setIsDraggingQueuePanel;
    const setCollapsed = isLeft ? setIsLeftPanelCollapsed : setIsQueueCollapsed;

    let moved = false;

    if (!collapsed) {
      if (!isTouch) e.preventDefault();
      setDragging(true);
    }

    const handleMove = (moveEvent) => {
      const movePoint = isTouch ? moveEvent.touches[0] : moveEvent;
      const delta = movePoint.clientX - startX;
      if (Math.abs(delta) > PANEL_TAP_MOVE_THRESHOLD) moved = true;
      if (collapsed) return; // no live width to drag from while collapsed
      const viewportCap = window.innerWidth / 2;
      const next = Math.min(maxWidth, viewportCap, Math.max(minWidth, startWidth + delta));
      setWidth(next);
    };

    const handleEnd = (endEvent) => {
      setDragging(false);

      if (isTouch) {
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("touchend", handleEnd);
        document.removeEventListener("touchcancel", handleEnd);

        if (endEvent.cancelable) endEvent.preventDefault();

        if (!moved) {
          const now = Date.now();
          const lastTap = lastPanelTapRef.current[panel] || 0;
          if (now - lastTap < PANEL_DOUBLE_TAP_WINDOW) {
            setCollapsed(prev => !prev);
            lastPanelTapRef.current[panel] = 0;
          } else {
            lastPanelTapRef.current[panel] = now;
          }
        }
      } else {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
      }
    };

    if (isTouch) {
      document.addEventListener("touchmove", handleMove, { passive: true });
      document.addEventListener("touchend", handleEnd);
      document.addEventListener("touchcancel", handleEnd);
    } else {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);
    }
  };

  const resetEventForm = () => {
    setEventForm({
      title: "",
      description: "",
      start_time: "",
      end_time: "",
      category: "Work",
      recurrence: "none",
      recurrence_end_date: "",
      days_of_week: [],
      timezone_mode: "absolute",
      home_timezone: null,
    });
    setRigidEditScope("instance");
    setEditingEvent(null);
    setFormCalendarIds([]);
    setRigidSaveError(null);
  };

  const resetFlexForm = () => {
    setFlexForm({
      name: "",
      duration: "",
      priority: 3,
      deadline: "",
    });
    setOriginalFlexForm({
      name: "",
      duration: "",
      priority: 3,
      deadline: "",
    });
    setEditingFlexEvent(null);
    setSelectedFlexId(null);
    setIsNewFlexItem(false);
  };

  const makeCellId = useCallback((date, hour) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return hour !== undefined && hour !== null ? `${dateStr}-${hour}` : dateStr;
  }, []);

  const makeRangeCell = useCallback((date, hour) => ({
    cellId: makeCellId(date, hour),
    dayKey: format(date, "yyyy-MM-dd"),
    hour,
  }), [makeCellId]);

  const clearRangeSelection = useCallback(() => {
    setSelectedRange({ startCell: null, endCell: null });
    isRangeSelectingRef.current = false;
    rangeSelectionMetaRef.current = null;
  }, []);

  const parseSelectedCell = () => {
    if (!selectedCell) {
      return null;
    }

    const match = selectedCell.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d{1,2}))?$/);
    if (!match) {
      return null;
    }

    const [, dateStr, hourStr] = match;
    const parsedDate = new Date(`${dateStr}T00:00:00`);

    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return {
      date: parsedDate,
      hour: hourStr !== undefined ? Number(hourStr) : null,
    };
  };

  const updateRangeSelection = useCallback((date, hour) => {
    const meta = rangeSelectionMetaRef.current;
    if (!meta) {
      return null;
    }

    const nextCell = makeRangeCell(date, hour);
    if (meta.view === "week" && nextCell.dayKey !== meta.startCell.dayKey) {
      return meta.startCell;
    }

    setSelectedRange((prev) => {
      if (
        prev.startCell?.cellId === meta.startCell.cellId &&
        prev.endCell?.cellId === nextCell.cellId
      ) {
        return prev;
      }

      return {
        startCell: meta.startCell,
        endCell: nextCell,
      };
    });

    return nextCell;
  }, [makeRangeCell]);

  const isHourCellInSelectedRange = useCallback((date, hour) => {
    const { startCell, endCell } = selectedRange;
    if (!startCell || !endCell || startCell.hour === null || endCell.hour === null) {
      return false;
    }

    const dayKey = format(date, "yyyy-MM-dd");
    if (dayKey !== startCell.dayKey || dayKey !== endCell.dayKey) {
      return false;
    }

    const rangeStart = Math.min(startCell.hour, endCell.hour);
    const rangeEnd = Math.max(startCell.hour, endCell.hour);
    return hour >= rangeStart && hour <= rangeEnd;
  }, [selectedRange]);

  const scrollToEightAM = () => {
    if (!calendarRef.current) return;
    const header =
      calendarRef.current.querySelector(".week-day-headers") ||
      calendarRef.current.querySelector(".day-view-header");
    const headerHeight = header ? header.offsetHeight : 0;
    calendarRef.current.scrollTop = headerHeight + 8 * HOUR_SLOT_HEIGHT;
  };

  useEffect(() => {
    if (view === "week" || view === "day") {
      scrollToEightAM();
    } else if (calendarRef.current) {
      calendarRef.current.scrollTop = 0;
    }
  }, [view, currentDate]);

  useEffect(() => {
    const handleDocumentMouseDown = (event) => {
      if (
        !event.target.closest("[data-range-cell='true']") &&
        !event.target.closest("[data-preserve-range-selection='true']")
      ) {
        clearRangeSelection();
      }
    };

    const handleDocumentMouseUp = () => {
      isRangeSelectingRef.current = false;
      rangeSelectionMetaRef.current = null;
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("mouseup", handleDocumentMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
    };
  }, [clearRangeSelection]);



  // ============== RIGID EVENT HANDLERS ==============
  
  const openNewRigidEventPanel = (date, hour = null, endHour = null) => {
    resetEventForm();
    resetFlexForm();
    setSelectedEventId(null);

    const eventDate = date || currentDate;
    const startTime = hour !== null 
      ? setMinutes(setHours(eventDate, hour), 0)
      : setMinutes(setHours(eventDate, 9), 0);
    const endTime = endHour !== null
      ? setMinutes(setHours(eventDate, endHour + 1), 0)
      : hour !== null
      ? setMinutes(setHours(eventDate, hour + 1), 0)
      : setMinutes(setHours(eventDate, 10), 0);

    setEventForm({
      title: "",
      description: "",
      start_time: format(startTime, "yyyy-MM-dd'T'HH:mm"),
      end_time: format(endTime, "yyyy-MM-dd'T'HH:mm"),
      category: "Work",
      recurrence: "none",
      recurrence_end_date: "",
      days_of_week: [startTime.getDay()],
      timezone_mode: "absolute",
      home_timezone: null,
    });
    setIsDescriptionExpanded(false);
    setIsCategoryExpanded(false);
    setIsRepeatExpanded(false);
    setRigidSaveError(null);
    setSelectedDate(eventDate);
    if (!selectedCell) {
      setSelectedCell(makeCellId(eventDate, hour));
    }
    // Default to whatever calendar(s) the user last explicitly picked via
    // the membership checkbox (filtered to ones still visible/accessible);
    // only fall back to the oldest calendar if nothing's been picked yet.
    // Having three calendars shown shouldn't triple-assign every new event;
    // additional calendars are opt-in via the membership checkbox in the
    // sidebar list.
    const rememberedCalendarIds = (lastFormCalendarIds || []).filter((id) =>
      calendars.some((cal) => cal.id === id)
    );
    setFormCalendarIds(
      rememberedCalendarIds.length > 0
        ? rememberedCalendarIds
        : calendars[0] ? [calendars[0].id] : []
    );
    setPanelMode("rigid-config");
  };

  const openEditRigidEventPanel = (event) => {
    resetFlexForm();
    setSelectedEventId(event.id);
    const editTimezone = event.timezone_mode === "naive"
      ? (event.home_timezone || globalSettings.timezone)
      : globalSettings.timezone;

    const editStartTime = utcIsoToTzLocal(event.start_time, editTimezone);
    setEventForm({
      title: event.title,
      description: event.description || "",
      start_time: editStartTime,
      end_time: utcIsoToTzLocal(event.end_time, editTimezone),
      category: event.category || "Work",
      recurrence: event.recurrence || "none",
      recurrence_end_date: event.recurrence_end_date
        ? format(new Date(event.recurrence_end_date), "yyyy-MM-dd")
        : "",
      days_of_week: event.days_of_week && event.days_of_week.length > 0
        ? event.days_of_week
        : [new Date(editStartTime).getDay()],
      timezone_mode: event.timezone_mode || "absolute",
      home_timezone: event.home_timezone || null,
    });
    setIsDescriptionExpanded(!!(event.description && event.description.trim()));
    setIsCategoryExpanded(false);
    setIsRepeatExpanded(false);
    setRigidSaveError(null);
    setEditingEvent(event);
    setRigidEditScope("instance");
    setFormCalendarIds(event.calendar_ids || []);
    setSelectedCell(null);
    setSelectedDate(getCalendarDateForTimezone(event.start_time, editTimezone));
    setPanelMode("rigid-config");
  };

  const handleSaveRigidEvent = async (scope = "series") => {
    const trimmedTitle = eventForm.title.trim();
    setRigidSaveError(null);

    if (eventForm.recurrence !== "none" && !eventForm.recurrence_end_date) {
      setRigidSaveError("Repeat Until date is required for recurring events.");
      return;
    }

    try {
      const preservedHomeTimezone = eventForm.home_timezone && eventForm.home_timezone !== "local"
        ? eventForm.home_timezone
        : getEffectiveTimezone(globalSettings.timezone);
      const startIso = eventForm.timezone_mode === "naive"
        ? tzLocalToUtcIso(eventForm.start_time, preservedHomeTimezone)
        : tzLocalToUtcIso(eventForm.start_time, globalSettings.timezone);
      const endIso = eventForm.timezone_mode === "naive"
        ? tzLocalToUtcIso(eventForm.end_time, preservedHomeTimezone)
        : tzLocalToUtcIso(eventForm.end_time, globalSettings.timezone);
      const baseTitle = trimmedTitle || "Item Name";
      const existingTitles = events
        .filter((e) => e.id !== editingEvent?.id && e.series_id !== editingEvent?.series_id)
        .map((e) => e.title);
      const titleToSave = getUniqueName(baseTitle, existingTitles);

      const eventData = {
        title: titleToSave,
        description: eventForm.description,
        start_time: startIso,
        end_time: endIso,
        category: eventForm.category,
        recurrence: eventForm.recurrence,
        recurrence_end_date: eventForm.recurrence_end_date
          ? new Date(eventForm.recurrence_end_date).toISOString()
          : null,
        days_of_week: eventForm.recurrence === "weekly" ? eventForm.days_of_week : null,
        timezone_mode: eventForm.timezone_mode,
        home_timezone: eventForm.timezone_mode === "naive" ? preservedHomeTimezone : null,
      };

      if (editingEvent) {
        // calendar_ids now comes from the membership checkboxes (only
        // rendered while this form is open) -- the update endpoint
        // replaces junction rows wholesale when it's provided.
        await axios.put(`${API}/events/${editingEvent.id}`, { ...eventData, calendar_ids: formCalendarIds }, {
          params: { scope },
        });
      } else {
        const writableCalendarIds = formCalendarIds.filter((id) =>
          calendars.some((cal) => canWriteCalendar(cal) && cal.id === id)
        );
        await axios.post(`${API}/events`, { ...eventData, calendar_ids: writableCalendarIds });
      }

      setPanelMode("idle");
      setSelectedCell(null);
      resetEventForm();
      fetchEvents();
    } catch (error) {
      console.error("Failed to save event:", error.response?.data || error.message, error);
      setRigidSaveError(error.response?.data?.detail || "Failed to save event.");
    }
  };

  const handleDeleteRigidEvent = async (scope = "series") => {
    if (!editingEvent) return;

    try {
      await axios.delete(`${API}/events/${editingEvent.id}`, {
        params: { scope },
      });

      setPanelMode("idle");
      setSelectedEventId(null);
      resetEventForm();
      fetchEvents();
    } catch (error) {
      console.error("Failed to delete event:", error);
    }
  };

  // ============== FLEX EVENT HANDLERS ==============
  
  const openNewFlexEventPanel = () => {
    resetEventForm();
    resetFlexForm();
    setIsNewFlexItem(true);
    
    // Create a temporary local item (not saved to DB yet)
    const tempId = `temp-${Date.now()}`;
    const tempEvent = {
      id: tempId,
      name: "",
      duration: 60,
      // Priority Phase 3: no auto-repositioning -- append to the end
      // instead of always forcing the top, which used to place a new task
      // above higher-priority items regardless of what priority it'd get.
      // Positioning from here is manual (drag), boundary-constrained by
      // the grey-lock once a priority is chosen.
      position: flexEvents.length,
      priority: 3,
      deadline: null,
      completed: false,
      FF_time_elapsed: 0,
      isTemp: true, // Mark as temporary/unsaved
    };

    setFlexEvents(prev => [...prev, tempEvent]);
    setSelectedFlexId(tempId);
    setEditingFlexEvent(tempEvent);
    setFlexForm({
      name: "",
      duration: "",
      priority: 3,
      deadline: "",
    });
    setOriginalFlexForm({
      name: "",
      duration: "",
      priority: 3,
      deadline: "",
    });
    setPanelMode("flex-config");
  };

  const openEditFlexEventPanel = (flexEvent) => {
    resetEventForm();
    setSelectedEventId(null);
    setSelectedCell(null);
    setSelectedFlexId(flexEvent.id);
    setEditingFlexEvent(flexEvent);
    setIsNewFlexItem(false);

    const formData = {
      name: flexEvent.name,
      duration: String(flexEvent.duration),
      priority: flexEvent.priority ?? 3,
      deadline: flexEvent.deadline ? utcIsoToTzLocal(flexEvent.deadline, globalSettings.timezone) : "",
    };
    setFlexForm(formData);
    setOriginalFlexForm(formData);
    setPanelMode("flex-config");
  };

  const handleFlexNameChange = (e) => {
    const newName = e.target.value;
    setFlexForm(prev => ({ ...prev, name: newName }));
    // Live update in list
    setFlexEvents(prev => prev.map(i => i.id === selectedFlexId ? { ...i, name: newName } : i));
  };

  const handleFlexDurationChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setFlexForm(prev => ({ ...prev, duration: value }));
  };

  const handleFlexPriorityChange = (e) => {
    setFlexForm(prev => ({ ...prev, priority: parseInt(e.target.value, 10) }));
  };

  const handleFlexDeadlineChange = (e) => {
    setFlexForm(prev => ({ ...prev, deadline: e.target.value }));
  };

  const getEffectiveDuration = () => {
    return flexForm.duration === "" ? 60 : parseInt(flexForm.duration) || 0;
  };

  const handleStepUp = () => {
    const current = getEffectiveDuration();
    const step = globalSettings.minDuration;
    setFlexForm(prev => ({ ...prev, duration: String(current + step) }));
  };

  const handleStepDown = () => {
    const current = getEffectiveDuration();
    const step = globalSettings.minDuration;
    const newVal = Math.max(0, current - step);
    setFlexForm(prev => ({ ...prev, duration: String(newVal) }));
  };

  const handleSaveFlexEvent = async () => {
    // In-flight guard -- see the isSavingFlexEvent declaration above.
    if (isSavingFlexEvent) return;
    setIsSavingFlexEvent(true);

    const finalDuration = flexForm.duration === "" ? 60 : parseInt(flexForm.duration) || 60;
    const finalPriority = flexForm.priority || 3;
    const finalDeadline = flexForm.deadline ? tzLocalToUtcIso(flexForm.deadline, globalSettings.timezone) : null;

    let nameToSave = flexForm.name || "Item Name";
    const existingNames = flexEvents
      .filter(i => i.id !== selectedFlexId)
      .map(i => i.name);
    nameToSave = getUniqueName(nameToSave, existingNames);

    // Re-sort the queue only when an existing task's priority is being
    // changed via edit -- a brand-new task keeps landing wherever it was
    // manually placed, with no auto-insert/auto-resort (see openNewFlexEventPanel).
    const priorityChanged = !isNewFlexItem && !!editingFlexEvent && finalPriority !== (originalFlexForm.priority || 3);
    const durationChanged = !isNewFlexItem && !!editingFlexEvent && finalDuration !== editingFlexEvent.duration;

    // Task Deadlines Part 3: preview the same resulting order the save
    // below will actually produce, before persisting anything.
    let hypotheticalOrder = flexEvents;
    if (priorityChanged) {
      hypotheticalOrder = [...flexEvents]
        .map(item => item.id === editingFlexEvent.id ? { ...item, priority: finalPriority } : item)
        .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));
    }
    const candidateItems = hypotheticalOrder.map(item => item.id === selectedFlexId ? {
      id: item.id, name: nameToSave, duration: finalDuration, priority: finalPriority,
      FF_time_elapsed: durationChanged ? 0 : (item.FF_time_elapsed ?? 0),
      deadline: finalDeadline,
    } : {
      id: item.id, name: item.name, duration: item.duration, priority: item.priority ?? 3,
      FF_time_elapsed: item.FF_time_elapsed ?? 0, deadline: item.deadline ?? null,
    });
    const affected = await checkDeadlineCascade(candidateItems);

    const performSave = async () => {
      // Block the clock tick from writing FF_time_elapsed while this save is
      // in-flight. Cleared in finally so it always unblocks, even on error.
      isSavingRef.current = true;
      try {
        if (isNewFlexItem) {
          // POST to create new event in database
          const createResponse = await axios.post(`${API}/flex-events`, {
            name: nameToSave,
            duration: finalDuration,
            priority: finalPriority,
            deadline: finalDeadline,
            // No `position` field -- the server always assigns it atomically;
            // a client-supplied value was a real concurrency bug, and the
            // reorder/batch call right below already re-establishes the real
            // intended order anyway.
          });
          // Persist the visual order — replace tempId with the real ID from the response,
          // then batch-reorder so positions match what the user sees
          const realId = createResponse.data.id;
          const orderedIds = flexEvents.map(i => i.id === selectedFlexId ? realId : i.id).filter(id => !id.startsWith("temp-"));
          await axios.put(`${API}/flex-events/reorder/batch`, { ordered_ids: orderedIds });
        } else if (editingFlexEvent) {
          if (priorityChanged) {
            const orderedIds = hypotheticalOrder.map(i => i.id).filter(id => !String(id).startsWith("temp-"));
            await axios.put(`${API}/flex-events/reorder/batch`, { ordered_ids: orderedIds });
          }
          // PUT to update existing event — only reset clock if duration actually changed
          await axios.put(`${API}/flex-events/${editingFlexEvent.id}`, {
            name: nameToSave,
            duration: finalDuration,
            priority: finalPriority,
            deadline: finalDeadline,
            ...(durationChanged && {
              FF_time_elapsed: 0,
              FF_time_remaining: finalDuration * 60,
            }),
          });
        }

        setPanelMode("idle");
        resetFlexForm();
        fetchFlexEvents();
      } catch (error) {
        console.error("Failed to save flex event:", error);
      } finally {
        // Always unblock the clock, even if the PUT threw
        isSavingRef.current = false;
      }
    };

    if (affected.length > 0) {
      setCascadeAffectedIds(new Set(affected.map(a => a.id)));
      setCascadeWarning({
        names: affected.map(a => a.name),
        onConfirm: async () => {
          setCascadeWarning(null);
          setCascadeAffectedIds(new Set());
          await performSave();
          setIsSavingFlexEvent(false);
        },
        onCancel: () => {
          setCascadeWarning(null);
          setCascadeAffectedIds(new Set());
          setIsSavingFlexEvent(false);
        },
      });
      return;
    }

    await performSave();
    setIsSavingFlexEvent(false);
  };

  const handleCancelFlexEvent = () => {
    if (isNewFlexItem) {
      // Just remove the temporary local item (not in DB)
      setFlexEvents(prev => prev.filter(i => i.id !== selectedFlexId));
    } else if (editingFlexEvent) {
      // Revert to original values in list
      setFlexEvents(prev => prev.map(i => i.id === selectedFlexId ? { 
        ...i, 
        name: originalFlexForm.name,
      } : i));
    }
    setPanelMode("idle");
    resetFlexForm();
  };

  const handleDeleteFlexEvent = async () => {
    if (!editingFlexEvent) return;
    
    try {
      await axios.delete(`${API}/flex-events/${editingFlexEvent.id}`);
      setPanelMode("idle");
      resetFlexForm();
      fetchFlexEvents();
    } catch (error) {
      console.error("Failed to delete flex event:", error);
    }
  };

  const handleToggleFlexEventChecked = (id, e) => {
    e.stopPropagation();
    setCheckedFlexIds((prev) =>
      prev.includes(id) ? prev.filter((existingId) => existingId !== id) : [...prev, id]
    );
  };

  const handleDeleteCheckedFlexEvents = async () => {
    if (checkedFlexIds.length === 0) return;

    const checkedSet = new Set(checkedFlexIds);
    const checkedItems = flexEvents.filter((item) => checkedSet.has(item.id));
    const tempItems = checkedItems.filter((item) => item.isTemp);
    const persistedItems = checkedItems.filter((item) => !item.isTemp);

    if (tempItems.length > 0) {
      const tempIds = new Set(tempItems.map((item) => item.id));
      setFlexEvents((prev) => prev.filter((item) => !tempIds.has(item.id)));
    }

    try {
      if (persistedItems.length > 0) {
        await Promise.all(persistedItems.map((item) => axios.delete(`${API}/flex-events/${item.id}`)));
      }

      if (selectedFlexId && checkedSet.has(selectedFlexId)) {
        setPanelMode("idle");
        resetFlexForm();
      }

      setCheckedFlexIds([]);
      fetchFlexEvents();
    } catch (error) {
      console.error("Failed to delete selected flex events:", error);
    }
  };

  const handleCompleteCheckedFlexEvents = async () => {
    if (checkedFlexIds.length === 0) return;

    const checkedSet = new Set(checkedFlexIds);
    const checkedItems = flexEvents.filter((item) => checkedSet.has(item.id));
    const tempItems = checkedItems.filter((item) => item.isTemp);
    const persistedItems = checkedItems.filter((item) => !item.isTemp);

    if (tempItems.length > 0) {
      const tempIds = new Set(tempItems.map((item) => item.id));
      setFlexEvents((prev) => prev.filter((item) => !tempIds.has(item.id)));
    }

    if (tempItems.length > 0) {
      const tempIds = new Set(tempItems.map((item) => item.id));
      setFlexEvents((prev) => prev.filter((item) => !tempIds.has(item.id)));
    }
    // Fixed — include FF_time_remaining snapshot on completion to avoid issues with clock updates after marking completed
    try {
      if (persistedItems.length > 0) {
        await Promise.all(
          persistedItems.map((item) => axios.put(`${API}/flex-events/${item.id}`, { 
            completed: true, 
            FF_time_elapsed: item.FF_time_elapsed ?? 0,
            FF_time_remaining: Math.max(0, (item.duration * 60) - (item.FF_time_elapsed ?? 0)),
          }))
        );
      }

      if (selectedFlexId && checkedSet.has(selectedFlexId)) {
        setPanelMode("idle");
        resetFlexForm();
      }

      if (selectedFlexId && checkedSet.has(selectedFlexId)) {
        setPanelMode("idle");
        resetFlexForm();
      }

      setCheckedFlexIds([]);
      fetchFlexEvents();
    } catch (error) {
      console.error("Failed to complete selected flex events:", error);
    }
  };

  // Drag handlers for flex queue
  const handleDragStart = (index) => {
    const item = flexEvents[index];
    // Defensive -- draggable={!isLocked} on the row already prevents this,
    // matching this codebase's existing dual-layer disable pattern. Checks
    // both grey-lock mechanisms: priority tier and (Task Deadlines Part 1)
    // deadline.
    if (item && (lockedFlexIds.has(item.id) || deadlineLockedIds.has(item.id))) return;
    hideFlexTooltip();
    dragItem.current = index;
    setDraggingFlexId(item?.id ?? null);
  };
  const handleDragEnter = (index) => {
    // Bidirectional drag boundary: never let a hover land outside the
    // dragged item's own tier range. Index-based, not "is this row locked"
    // -- dropping at an index can precede/follow a locked item even when the
    // hovered row itself isn't locked (e.g. an interleaved, non-tier-grouped
    // queue).
    //
    // Downward hovers (index past the dragged item's own slot) need the
    // upper bound tightened by one: handleDragEnd's splice removes the
    // dragged item first, which shifts every later index down by one, so
    // landing "at" upperBoundaryIndex during a downward drag actually lands
    // AFTER the item there, not before it -- one step too far. The lower
    // bound doesn't need this: it's already defined one past its own
    // boundary item, which already absorbs that same shift.
    const isDownwardHover = dragItem.current !== null && index > dragItem.current;
    if (focusPriority !== null) {
      const effectiveUpperBound = isDownwardHover ? upperBoundaryIndex - 1 : upperBoundaryIndex;
      if (index < lowerBoundaryIndex || index > effectiveUpperBound) return;
    }
    // Task Deadlines Part 1: deadline grey-lock's boundary is upper-only
    // (no lower bound) -- combined with the priority boundary above by
    // taking the tighter (smaller) ceiling, same splice-shift adjustment
    // for a downward hover.
    if (focusDeadline !== null) {
      const effectiveDeadlineUpperBound = isDownwardHover ? deadlineUpperBoundaryIndex - 1 : deadlineUpperBoundaryIndex;
      if (index > effectiveDeadlineUpperBound) return;
    }
    dragOverItem.current = index;
  };
  const handleDragEnd = async () => {
    setDraggingFlexId(null); // grey-lock always clears on release, success or not
    if (dragItem.current === null) return;

    // An illegal drop (nothing legal was ever entered) redirects to the
    // earliest legal spot rather than leaving the item where it was.
    const dropIndex = dragOverItem.current !== null ? dragOverItem.current : lowerBoundaryIndex;

    const newItems = [...flexEvents];
    const dragged = newItems.splice(dragItem.current, 1)[0];
    newItems.splice(dropIndex, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;

    const commitReorder = async () => {
      setFlexEvents(newItems);
      try {
        await axios.put(`${API}/flex-events/reorder/batch`, {
          ordered_ids: newItems.map(item => item.id),
        });
      } catch (error) {
        console.error("Failed to save flex event order:", error);
        fetchFlexEvents(); // Revert on error
      }
    };

    // Task Deadlines Part 3: preview this reorder before committing --
    // nothing is applied to flexEvents/persisted until this resolves.
    const candidateItems = newItems.map(item => ({
      id: item.id, name: item.name, duration: item.duration, priority: item.priority ?? 3,
      FF_time_elapsed: item.FF_time_elapsed ?? 0, deadline: item.deadline ?? null,
    }));
    const affected = await checkDeadlineCascade(candidateItems);

    if (affected.length > 0) {
      setCascadeAffectedIds(new Set(affected.map(a => a.id)));
      setCascadeWarning({
        names: affected.map(a => a.name),
        onConfirm: async () => {
          setCascadeWarning(null);
          setCascadeAffectedIds(new Set());
          await commitReorder();
        },
        onCancel: () => {
          setCascadeWarning(null);
          setCascadeAffectedIds(new Set());
        },
      });
      return;
    }

    await commitReorder();
  };


  const handlePlacedFlexClick = (flexEventId, fragment, e) => {
    e.stopPropagation();
    clearRangeSelection();
    
    // Clear any selected cell
    setSelectedCell(null);
    
    // Set selectedDate from the fragment's scheduled start time
    if (fragment?.start_time) {
      setSelectedDate(getCalendarDateForTimezone(fragment.start_time, globalSettings.timezone));
    }
    
    // Find the flex event in the queue
    const flexEvent = flexEvents.find(f => f.id === flexEventId);
    if (flexEvent) {
      openEditFlexEventPanel(flexEvent);
    }
  };

  // ============== UNIFIED HANDLERS ==============
  
  const handleNewEvent = () => {
    if (eventTypeToggle === "rigid") {
      const { startCell, endCell } = selectedRange;
      const hasMultiCellRange =
        !!startCell &&
        !!endCell &&
        startCell.hour !== null &&
        endCell.hour !== null &&
        startCell.cellId !== endCell.cellId;

      if (hasMultiCellRange) {
        const rangeDate = new Date(`${startCell.dayKey}T00:00:00`);
        const rangeStartHour = Math.min(startCell.hour, endCell.hour);
        const rangeEndHour = Math.max(startCell.hour, endCell.hour);
        openNewRigidEventPanel(rangeDate, rangeStartHour, rangeEndHour);
        return;
      }

      const selectedCellInfo = parseSelectedCell();
      openNewRigidEventPanel(
        selectedCellInfo?.date || selectedDate,
        selectedCellInfo?.hour ?? null
      );
    } else {
      openNewFlexEventPanel();
    }
  };

  const handleCellClick = (date, hour = null) => {
    clearRangeSelection();
    // Clicking empty cell → idle mode, discard edits
    // If in flex-config mode with unsaved temp event, just remove from local state
    if (panelMode === "flex-config" && isNewFlexItem) {
      setFlexEvents(prev => prev.filter(i => i.id !== selectedFlexId));
    } else if (panelMode === "flex-config" && editingFlexEvent) {
      // Revert to original values in list
      setFlexEvents(prev => prev.map(i => i.id === selectedFlexId ? { 
        ...i, 
        name: originalFlexForm.name,
      } : i));
    }
    
    setSelectedDate(date);
    setSelectedCell(makeCellId(date, hour));
    setSelectedEventId(null);
    setPanelMode("idle");
    resetEventForm();
    resetFlexForm();
  };

  const handleCalendarEventClick = (event, e) => {
    e.stopPropagation();
    clearRangeSelection();
    // Clicking a calendar event → opens rigid config (discards any current edits)
    // NOTE: `event` here may be a display-clipped copy (see getEventsForDate),
    // which fakes start_time/end_time to fit a single day's column for
    // multi-day events. Always resolve back to the real source-of-truth
    // event by id before opening it for editing.
    const sourceEvent = events.find((e2) => e2.id === event.id) || event;
    setSelectedEventId(sourceEvent.id);
    openEditRigidEventPanel(sourceEvent);
  };

  const handleFlexEventClick = (flexEvent) => {
    clearRangeSelection();
    // Clicking a flex queue item → opens flex config (discards any current edits)
    openEditFlexEventPanel(flexEvent);
  };

  const hideFlexTooltip = () => {
    setHoveredFlexId(null);
    if (tooltipElRef.current) {
      tooltipElRef.current.style.opacity = "0";
    }
  };

  const handleRangeSelectionStart = (date, hour) => {
    const startCell = makeRangeCell(date, hour);
    isRangeSelectingRef.current = true;
    rangeSelectionMetaRef.current = { startCell, view };
    setSelectedRange({ startCell, endCell: startCell });
    setSelectedCell(null);
    setSelectedEventId(null);
  };

  const handleRangeSelectionMove = (date, hour) => {
    if (!isRangeSelectingRef.current) {
      return;
    }

    updateRangeSelection(date, hour);
  };

  const handleRangeSelectionEnd = (date, hour) => {
    if (!isRangeSelectingRef.current) {
      return;
    }

    const startCell = rangeSelectionMetaRef.current?.startCell;
    const endCell = updateRangeSelection(date, hour) || startCell;
    setFlexEvents(prev => prev.filter(i => !i.isTemp));
    setPanelMode("idle");
    isRangeSelectingRef.current = false;
    rangeSelectionMetaRef.current = null;

    if (startCell && endCell && startCell.cellId === endCell.cellId) {
      handleCellClick(date, hour);
    }
  };

  const handleCancelConfig = () => {
    if (panelMode === "flex-config") {
      handleCancelFlexEvent();
    } else {
      setPanelMode("idle");
      setSelectedCell(null);
      setSelectedEventId(null);
      resetEventForm();
      resetFlexForm();
    }
  };

  // ============== RENDER HELPERS ==============

  // Staged Calendar Editing -- while a draft covers a given calendar, every
  // render site that would otherwise read its live color/eye state
  // substitutes the draft's value instead -- on Cancel/click-away
  // calendarConfigDraft goes back to null and these collapse back to real
  // state automatically, nothing to roll back.
  const getEffectiveCalendarColor = (cal) =>
    calendarConfigDraft && cal.id === configCalendarId
      ? (calendarConfigDraft.color || DEFAULT_CALENDAR_COLOR)
      : (cal.color || DEFAULT_CALENDAR_COLOR);

  const getEffectiveCalendarEyeState = (calendarId) =>
    calendarConfigDraft && calendarId === configCalendarId
      ? calendarConfigDraft.eye
      : (calendarEyeStates[calendarId] ?? 0);

  // Availability Matrix Phase 3 -- an event's rendered eye state across
  // every calendar it belongs to: 0 if all its calendars are off, else the
  // highest (most permissive) state among the ones that are on. Mirrors
  // the backend's own most-permissive-wins detail-level convention,
  // applied per-viewer per-event on the frontend
  // instead of per-share on the backend. Shared by getEventsForDate's
  // visibility filter and all 3 event-card render sites, so "is this
  // event shown at all" and "at what detail" never drift apart.
  const getEventEyeState = (event) =>
    (event.calendar_ids || []).reduce((max, id) => Math.max(max, getEffectiveCalendarEyeState(id)), 0);

  const getEventsForDate = (date) => {
    const tz = getEffectiveTimezone(globalSettings.timezone);
    const offsetMs = getTimezoneOffsetMinutes(tz) * 60000;
    const dateStr = format(date, "yyyy-MM-dd");
    const dayStart = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - offsetMs);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    return events
      // Availability Matrix: calendarEyeStates folds calendar membership +
      // per-viewer eye state together, so this is where "does this event
      // render at all, and how" is decided (getEventEyeState = most-
      // permissive state across the event's calendars):
      //   0 (off)        -> never render.
      //   2 (full)       -> always render, titled + clickable. Unchanged.
      //   1 (blocks-only) -> render a title-less .event-card-blocks-only block.
      .filter((event) => getEventEyeState(event) !== 0)
      .filter((event) => {
        const start = new Date(event.start_time);
        const end = new Date(event.end_time);
        return start < dayEnd && end > dayStart;
      })
      .map((event) => {
        const start = new Date(event.start_time);
        const end = new Date(event.end_time);
        const clippedStart = start < dayStart ? dayStart : start;
        const clippedEnd = end > dayEnd ? dayEnd : end;
        if (clippedStart.getTime() === start.getTime() && clippedEnd.getTime() === end.getTime()) {
          return event;
        }
        return { ...event, start_time: clippedStart.toISOString(), end_time: clippedEnd.toISOString() };
      });
  };

  // Get all placed flex fragments for a given date, clipped to that day's
  // bounds. Mirrors getEventsForDate's day-overlap-filter + day-clip-map
  // shape exactly (see that function just above) -- the placement engine
  // only splits a fragment at open/closed block boundaries, never at day
  // boundaries, so a fragment can
  // legitimately span midnight and must render on every day it touches,
  // not just the day its start_time falls on. Before this, a fragment
  // ending the next day was included (unclipped) only on its start day and
  // never appeared on the following day at all, and its un-clipped
  // duration produced an oversized div overflowing past the bottom of the
  // grid.
  const getPlacedFlexFragmentsForDate = (date) => {
    const tz = getEffectiveTimezone(globalSettings.timezone);
    const offsetMs = getTimezoneOffsetMinutes(tz) * 60000;
    const dateStr = format(date, "yyyy-MM-dd");
    const dayStart = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - offsetMs);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    return placedFlexItems
      .flatMap((item) => item.fragments)
      .filter((fragment) => {
        const start = new Date(fragment.start_time);
        const end = new Date(fragment.end_time);
        return start < dayEnd && end > dayStart;
      })
      .map((fragment) => {
        const start = new Date(fragment.start_time);
        const end = new Date(fragment.end_time);
        const clippedStart = start < dayStart ? dayStart : start;
        const clippedEnd = end > dayEnd ? dayEnd : end;
        if (clippedStart.getTime() === start.getTime() && clippedEnd.getTime() === end.getTime()) {
          return fragment;
        }
        return { ...fragment, start_time: clippedStart.toISOString(), end_time: clippedEnd.toISOString() };
      });
  };

  // Month view only: show one card per flex task per day even if it has multiple fragments.
  const getPlacedFlexTasksForDate = (date) => {
    const taskMap = new Map();

    for (const item of placedFlexItems) {
      for (const fragment of item.fragments) {
        const fragmentDate = new Date(fragment.start_time);
        if (!isSameDay(fragmentDate, date)) {
          continue;
        }

        const existing = taskMap.get(fragment.flex_event_id);
        if (!existing || new Date(fragment.start_time) < new Date(existing.start_time)) {
          taskMap.set(fragment.flex_event_id, fragment);
        }
      }
    }

    return Array.from(taskMap.values());
  };

  const getPlacedFlexPositionStyle = (fragment, cascadeIndex = 0) => {
    const { hours: startH, minutes: startM } = getLocalizedHoursMinutes(fragment.start_time, globalSettings.timezone);
    const { hours: endH, minutes: endM } = getLocalizedHoursMinutes(fragment.end_time, globalSettings.timezone);
    const startMinutes = startH * 60 + startM;
    const rawEndMinutes = endH * 60 + endM;
    const endMinutes = rawEndMinutes <= startMinutes ? rawEndMinutes + 1440 : rawEndMinutes;
    const durationMinutes = Math.max(15, endMinutes - startMinutes);
    const minuteOffset = startMinutes % 60;
    const top = (minuteOffset / 60) * HOUR_SLOT_HEIGHT;
    const height = (durationMinutes / 60) * HOUR_SLOT_HEIGHT;
    const adjustedIndex = Math.min(cascadeIndex, MAX_CASCADE_COLUMNS - 1);
    const cascadeOffset = adjustedIndex * 3;

    return {
      position: "absolute",
      top: `${top + cascadeOffset}px`,
      height: `${height}px`,
      left: "16px",
      width: "calc(100% - 16px)",
      transform: `translateX(${cascadeOffset}px)`,
      overflow: "hidden",
      zIndex: 10 + adjustedIndex,
    };
  };

  const getEventCategoryClass = (category) => {
    const cat = EVENT_CATEGORIES.find((c) => c.value === category);
    return cat ? cat.className : "event-work";
  };

  // Small colored dots on an event card, one per owning calendar (same
  // swatch convention as the sidebar's .calendar-row-swatch) -- shown
  // regardless of which calendars are currently checked, since membership
  // itself doesn't change with the view's filter state. Capped at 3 with a
  // "+N" overflow, matching this file's existing month-view "+N more"
  // convention. `calendars` is oldest-first (GET /calendars ordering), so
  // dot order is deterministic without needing a tiebreak rule.
  const MAX_EVENT_CALENDAR_DOTS = 3;
  const getEventCalendarDots = (event) => {
    const owners = calendars.filter((cal) => event.calendar_ids?.includes(cal.id));
    return {
      shown: owners.slice(0, MAX_EVENT_CALENDAR_DOTS),
      overflow: Math.max(0, owners.length - MAX_EVENT_CALENDAR_DOTS),
    };
  };

  const renderEventCalendarDots = (event) => {
    const { shown, overflow } = getEventCalendarDots(event);
    if (shown.length === 0) return null;
    return (
      <span className="event-card-calendar-dots">
        {shown.map((cal) => (
          <span
            key={cal.id}
            className="event-card-calendar-dot"
            style={{ backgroundColor: getEffectiveCalendarColor(cal) }}
            aria-hidden="true"
          />
        ))}
        {overflow > 0 && <span className="event-card-calendar-dot-overflow">+{overflow}</span>}
      </span>
    );
  };

  // Which event IDs should render as "selected" on the calendar. For a
  // non-recurring event (or when nothing is being edited) this is just the
  // single clicked event, matching the old selectedEventId === event.id
  // check exactly. For a recurring instance, it expands based on scope:
  // instance -> just the clicked one, series -> the whole series_id group,
  // now-and-future -> that group filtered to start_time >= the clicked
  // event's start_time. All start_time values are backend-normalized UTC
  // ISO strings with a consistent offset, so string comparison is safe.
  const highlightedEventIds = useMemo(() => {
    if (!editingEvent) return new Set();
    if (editingEvent.recurrence === "none" || !editingEvent.series_id) {
      return new Set([editingEvent.id]);
    }
    if (rigidEditScope === "series") {
      return new Set(
        events.filter((e) => e.series_id === editingEvent.series_id).map((e) => e.id)
      );
    }
    if (rigidEditScope === "now-and-future") {
      return new Set(
        events
          .filter((e) => e.series_id === editingEvent.series_id && e.start_time >= editingEvent.start_time)
          .map((e) => e.id)
      );
    }
    return new Set([editingEvent.id]); // "instance"
  }, [editingEvent, rigidEditScope, events]);

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = [];
    let day = startDate;

    while (day <= endDate) {
      days.push(day);
      day = addDays(day, 1);
    }

    return (
      <div ref={calendarRef} className="calendar-view">
        <div className="day-headers">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
            <div key={dayName} className="day-header">
              {dayName}
            </div>
          ))}
        </div>
        <div className="calendar-grid">
          {days.map((day, index) => {
            const dayEvents = getEventsForDate(day);
            const dayFlexTasks = getPlacedFlexTasksForDate(day);
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentDate);
            const dayCellId = makeCellId(day);

            return (
              <div
                key={index}
                className={`calendar-cell ${!isCurrentMonth ? "outside-month" : ""} ${isToday ? "today" : ""} ${selectedCell === dayCellId ? "selected" : ""}`}
                onClick={() => {
                  setCurrentDate(day);
                  handleCellClick(day);
                }}
                data-testid={`calendar-cell-${format(day, "yyyy-MM-dd")}`}
              >
                <div className="day-number">{format(day, "d")}</div>
                <div className="events-container">
                  {/* Placed flex tasks (deduped by task for month view) */}
                  {dayFlexTasks.map((fragment, fragIndex) => (
                    <div
                      key={`flex-${fragment.flex_event_id}-${fragment.fragment_index}`}
                      className={`event-card event-flex ${selectedFlexId === fragment.flex_event_id ? "selected-event" : ""}`}
                      onClick={(e) => handlePlacedFlexClick(fragment.flex_event_id, fragment, e)}
                      data-testid={`placed-flex-item-${fragIndex}`}
                    >
                      {fragment.flex_event_name}{fragment.is_continuation ? " (cont)" : ""}
                    </div>
                  ))}
                  {dayEvents.slice(0, Math.max(0, 3 - dayFlexTasks.length)).map((event, eventIndex) => {
                    const eyeState = getEventEyeState(event);
                    return (
                      <div
                        key={eventIndex}
                        className={`event-card ${getEventCategoryClass(event.category)} ${highlightedEventIds.has(event.id) ? "selected-event" : ""} ${eyeState === 1 ? "event-card-blocks-only" : ""}`}
                        onClick={eyeState >= 2 ? (e) => handleCalendarEventClick(event, e) : undefined}
                        data-testid={`event-${event.id}`}
                      >
                        {renderEventCalendarDots(event)}
                        {eyeState >= 2 && event.recurrence !== "none" && <Repeat size={10} className="inline mr-1" />}
                        {eyeState >= 2 && event.title}
                      </div>
                    );
                  })}
                  {(dayEvents.length + dayFlexTasks.length) > 3 && (
                    <div className="text-xs text-gray-500 pl-1">
                      +{dayEvents.length + dayFlexTasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const hours = Array.from({ length: 24 }, (_, i) => i);

    const dayCascadeIndexes = new Map();
    days.forEach((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      dayCascadeIndexes.set(dayKey, computeCascadeIndexes(getEventsForDate(day)));
    });

    return (
      <div ref={calendarRef} className="calendar-view">
        <div className="week-day-headers">
          <div className="week-day-header"></div>
          {days.map((day, index) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={index} className="week-day-header">
                <div className="week-day-name">{format(day, "EEE")}</div>
                <div className={`week-day-number ${isToday ? "today" : ""}`}>
                  {format(day, "d")}
                </div>
              </div>
            );
          })}
        </div>
        <div className="week-grid">
          {hours.map((hour) => (
            <>
              <div key={`time-${hour}`} className="week-time-slot" style={{ borderRight: "1px solid #F5F5F5" }}>
                <span className="text-xs text-gray-500">
                  {format(setHours(new Date(), hour), "ha")}
                </span>
              </div>
              {days.map((day, dayIndex) => {
                const dayEvents = getEventsForDate(day).filter((event) => {
                  const eventHour = getLocalizedHoursMinutes(event.start_time, globalSettings.timezone, event.timezone_mode, event.home_timezone).hours;
                  return eventHour === hour;
                });
                const cellId = makeCellId(day, hour);
                const cascadeIndexes = dayCascadeIndexes.get(format(day, "yyyy-MM-dd"));
                
                // Get flex fragments that start at this hour
                const flexFragmentsAtHour = getPlacedFlexFragmentsForDate(day).filter(
                  f => getLocalizedHoursMinutes(f.start_time, globalSettings.timezone).hours === hour
                );

                return (
                  <div
                    key={`${hour}-${dayIndex}`}
                    className={`week-time-slot ${selectedCell === cellId || isHourCellInSelectedRange(day, hour) ? "selected" : ""}`}
                    style={{ borderLeft: "1px solid #F5F5F5", cursor: "pointer" }}
                    data-range-cell="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleRangeSelectionStart(day, hour);
                    }}
                    onMouseMove={() => handleRangeSelectionMove(day, hour)}
                    onMouseUp={() => handleRangeSelectionEnd(day, hour)}
                    data-testid={`week-cell-${format(day, "yyyy-MM-dd")}-${hour}`}
                  >
                    {/* Placed flex fragments */}
                    {flexFragmentsAtHour.map((fragment, fragIndex) => (
                      <div
                        key={`flex-${fragment.flex_event_id}-${fragment.fragment_index}`}
                        className={`event-card event-flex ${selectedFlexId === fragment.flex_event_id ? "selected-event" : ""}`}
                        style={getPlacedFlexPositionStyle(fragment, fragIndex)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => handlePlacedFlexClick(fragment.flex_event_id, fragment, e)}
                        data-testid={`placed-flex-item-week-${fragIndex}`}
                      >
                        {fragment.flex_event_name}{fragment.is_continuation ? " (cont)" : ""}
                      </div>
                    ))}
                    {dayEvents.map((event) => {
                      const cascadeIndex = cascadeIndexes.get(event.id) || 0;
                      const eyeState = getEventEyeState(event);
                      return (
                        <div
                          key={event.id}
                          className={`event-card ${getEventCategoryClass(event.category)} ${highlightedEventIds.has(event.id) ? "selected-event" : ""} ${eyeState === 1 ? "event-card-blocks-only" : ""}`}
                          style={getEventPositionStyle(event, flexFragmentsAtHour.length + cascadeIndex)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={eyeState >= 2 ? (e) => handleCalendarEventClick(event, e) : undefined}
                        >
                          {renderEventCalendarDots(event)}
                          {eyeState >= 2 && event.recurrence !== "none" && <Repeat size={10} className="inline mr-1" />}
                          {eyeState >= 2 && event.title}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const dayEvents = getEventsForDate(currentDate);
    const cascadeIndexes = computeCascadeIndexes(dayEvents);
    const flexFragments = getPlacedFlexFragmentsForDate(currentDate);

    return (
      <div ref={calendarRef} className="calendar-view">
        <div>
          {hours.map((hour) => {
            const hourEvents = dayEvents.filter((event) => {
              const eventHour = getLocalizedHoursMinutes(event.start_time, globalSettings.timezone, event.timezone_mode, event.home_timezone).hours;
              return eventHour === hour;
            });

            const cellId = makeCellId(currentDate, hour);
            const flexFragmentsAtHour = flexFragments.filter(
              f => getLocalizedHoursMinutes(f.start_time, globalSettings.timezone).hours === hour
            );

            return (
              <div key={hour} className={`day-time-slot ${selectedCell === cellId || isHourCellInSelectedRange(currentDate, hour) ? "selected" : ""}`}>
                <div
                  className="day-time-label"
                  data-range-cell="true"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleRangeSelectionStart(currentDate, hour);
                  }}
                  onMouseMove={() => handleRangeSelectionMove(currentDate, hour)}
                  onMouseUp={() => handleRangeSelectionEnd(currentDate, hour)}
                >
                  {format(setHours(new Date(), hour), "h a")}
                </div>
                <div
                  className="day-time-content"
                  data-range-cell="true"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleRangeSelectionStart(currentDate, hour);
                  }}
                  onMouseMove={() => handleRangeSelectionMove(currentDate, hour)}
                  onMouseUp={() => handleRangeSelectionEnd(currentDate, hour)}
                  data-testid={`day-slot-${hour}`}
                >
                  {/* Placed flex fragments */}
                  {flexFragmentsAtHour.map((fragment, fragIndex) => (
                    <div
                      key={`flex-${fragment.flex_event_id}-${fragment.fragment_index}`}
                      className={`event-card event-flex ${selectedFlexId === fragment.flex_event_id ? "selected-event" : ""}`}
                      style={getPlacedFlexPositionStyle(fragment, fragIndex)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => handlePlacedFlexClick(fragment.flex_event_id, fragment, e)}
                      data-testid={`placed-flex-item-day-${fragIndex}`}
                    >
                      {fragment.flex_event_name}{fragment.is_continuation ? " (cont)" : ""}
                    </div>
                  ))}
                  {hourEvents.map((event) => {
                    const cascadeIndex = cascadeIndexes.get(event.id) || 0;
                    const eyeState = getEventEyeState(event);
                    return (
                      <div
                        key={event.id}
                        className={`event-card ${getEventCategoryClass(event.category)} ${highlightedEventIds.has(event.id) ? "selected-event" : ""} ${eyeState === 1 ? "event-card-blocks-only" : ""}`}
                        style={getEventPositionStyle(event, flexFragmentsAtHour.length + cascadeIndex)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={eyeState >= 2 ? (e) => handleCalendarEventClick(event, e) : undefined}
                      >
                        {renderEventCalendarDots(event)}
                        {eyeState >= 2 && event.recurrence !== "none" && <Repeat size={10} className="inline mr-1" />}
                        {eyeState >= 2 && event.title}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getHeaderTitle = () => {
    if (view === "month") {
      return format(currentDate, "MMMM yyyy");
    } else if (view === "week") {
      const weekStart = startOfWeek(currentDate);
      const weekEnd = endOfWeek(currentDate);
      return `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
    } else {
      return format(currentDate, "EEEE, MMMM d");
    }
  };

  // ============== RENDER FLEX QUEUE ==============
  
  const renderFlexQueueItem = (item, index) => {
    const isSelected = item.id === selectedFlexId;
    const isDeadlineLocked = deadlineLockedIds.has(item.id);
    const isLocked = lockedFlexIds.has(item.id) || isDeadlineLocked;
    const isCascadeAffected = cascadeAffectedIds.has(item.id);
    const isChecked = checkedFlexIds.includes(item.id);
    const hasName = item.name && item.name.trim() !== "";
    const placedItem = placedFlexItems.find((p) => p.flex_event_id === item.id);
    const hasFragments = placedItem?.fragments?.length > 0;
    const hasInsufficientTime = !!item.deadline && placedItem?.insufficient_time === true;
    const trSeconds = Math.max(0, (item.duration * 60) - (item.FF_time_elapsed ?? 0));
    const durationLabel = trSeconds >= 3600
      ? `${Math.floor(trSeconds / 3600)}h ${Math.floor((trSeconds % 3600) / 60)}m ${trSeconds % 60}s`
      : trSeconds >= 60
      ? `${Math.floor(trSeconds / 60)}m ${trSeconds % 60}s`
      : `${trSeconds}s`;
    return (
      <div
        key={item.id}
        data-testid={`flex-item-${index}`}
        className={`flex-queue-item ${isSelected ? "selected" : ""} ${isLocked ? "locked" : ""} ${isCascadeAffected ? "cascade-affected" : ""}`}
        draggable={!isLocked}
        onMouseDown={hideFlexTooltip}
        onDragStart={() => handleDragStart(index)}
        onDragEnter={() => handleDragEnter(index)}
        onDragEnd={handleDragEnd}
        onDragOver={e => e.preventDefault()}
        onMouseEnter={() => hasFragments && setHoveredFlexId(item.id)}
        onMouseMove={(e) => {
          if (tooltipElRef.current) {
            tooltipElRef.current.style.top = `${e.clientY + 16}px`;
            tooltipElRef.current.style.left = `${e.clientX + 12}px`;
            tooltipElRef.current.style.opacity = '1';
          }
        }}
        onMouseLeave={() => setHoveredFlexId(null)}
        onClick={() => handleFlexEventClick(item)}
      >
        <div className="flex-queue-item-row">
          <div className="flex-queue-item-drag">
            <GripVertical size={14} />
          </div>
          <span className={`flex-queue-item-name ${!hasName ? "placeholder" : ""}`}>
            {hasName ? item.name : "Item Name"}
          </span>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {durationLabel}
          </span>
          {item.deadline && (
            <span className="flex-deadline-badge" data-testid={`flex-deadline-badge-${index}`}>
              <Clock size={11} />
              {formatDeadlineBadge(item.deadline)}
            </span>
          )}
          <input
            type="checkbox"
            data-testid={`check-btn-${index}`}
            className="flex-queue-item-check"
            checked={isChecked}
            onChange={(e) => handleToggleFlexEventChecked(item.id, e)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {hasInsufficientTime && (
          <div className="flex-deadline-banner" data-testid={`flex-insufficient-time-${index}`}>
            <AlertTriangle size={12} />
            You don't have capacity to finish this before its deadline. Move it to a later date, or make room elsewhere in your queue.
          </div>
        )}
      </div>
    );
  };

  const renderFlexQueue = () => {
    const allChecked = flexEvents.length > 0 && checkedFlexIds.length === flexEvents.length;
    const hasCheckedItems = checkedFlexIds.length > 0;

    return (
      <div className="flex-queue" data-testid="flex-queue">
        <div className="flex-queue-header">
          <div className="flex-queue-header-row">
            <span className="flex-queue-title">Flex Queue</span>
            <label className="flex-queue-select-all" data-testid="select-all-label">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => {
                  if (allChecked) {
                    setCheckedFlexIds([]);
                    return;
                  }
                  setCheckedFlexIds(flexEvents.map((item) => item.id));
                }}
                data-testid="select-all-flex"
              />
              <span>Select All</span>
            </label>
          </div>
          <div className="flex-queue-actions-row">
            <button
              className="flex-queue-action-btn delete"
              onClick={handleDeleteCheckedFlexEvents}
              disabled={!hasCheckedItems}
              data-testid="bulk-delete-flex-btn"
            >
              Delete
            </button>
            <button
              className="flex-queue-action-btn complete"
              onClick={handleCompleteCheckedFlexEvents}
              disabled={!hasCheckedItems}
              data-testid="bulk-complete-flex-btn"
            >
              Complete
            </button>
          </div>
        </div>
        <div className="flex-queue-content">
          <div className="flex-queue-list">
            {flexEvents.length === 0 && (
              <div className="flex-queue-empty" data-testid="empty-state">
                No flex events
              </div>
            )}
            {flexEvents.map((item, i) => renderFlexQueueItem(item, i))}
          </div>
          {hoveredFlexId && (() => {
            const hp = placedFlexItems.find(p => p.flex_event_id === hoveredFlexId);
            return hp ? <FlexTooltip fragments={hp.fragments} divRef={tooltipElRef} timezone={globalSettings.timezone} /> : null;
          })()}
        </div>
      </div>
    );
  };

  // ============== RENDER SIDEBAR PANELS ==============
  
  const renderIdlePanel = () => (
    <div className="flex flex-col flex-1">
      <div className="flex flex-col gap-4 flex-1">
        {/* Event Type Toggle */}
        <div className="event-type-toggle" data-testid="event-type-toggle">
          <button
            className={`event-type-btn ${eventTypeToggle === "rigid" ? "active" : ""}`}
            onClick={() => setEventTypeToggle("rigid")}
            data-testid="toggle-rigid"
          >
            Events
          </button>
          <button
            className={`event-type-btn ${eventTypeToggle === "flex" ? "active" : ""}`}
            onClick={() => setEventTypeToggle("flex")}
            data-testid="toggle-flex"
          >
            Tasks
          </button>
        </div>
        
        {(() => {
          const hasWritableCheckedCalendar = checkedCalendarIds.some((id) =>
            calendars.some((cal) => canWriteCalendar(cal) && cal.id === id)
          );
          return (
            <>
              <button
                className={`add-event-btn${hasWritableCheckedCalendar ? "" : " add-event-btn-disabled"}`}
                aria-disabled={!hasWritableCheckedCalendar}
                onClick={() => {
                  // A natively `disabled` button fires no click event at all,
                  // which would silently swallow this case -- aria-disabled
                  // plus a live handler is what lets the message show.
                  if (!hasWritableCheckedCalendar) {
                    setAddButtonBlockedMessage(true);
                    return;
                  }
                  setAddButtonBlockedMessage(false);
                  handleNewEvent();
                }}
                data-preserve-range-selection="true"
                data-testid="add-event-btn"
              >
                <Plus size={18} />
                Add
              </button>
              {addButtonBlockedMessage && !hasWritableCheckedCalendar && (
                <p className="add-event-blocked-message" data-testid="add-event-blocked-message">
                  None of the calendars selected below have edit rights.
                </p>
              )}
            </>
          );
        })()}
      </div>
      
      {/* Settings Button at bottom */}
      <div className="mt-auto pt-4">
        <button
          className="settings-btn"
          onClick={() => {
            // Initialize settings form from current global settings
            setSettingsForm({
              minDuration: String(globalSettings.minDuration),
              timezone: globalSettings.timezone,
            });
            setPanelMode("settings");
          }}
          data-testid="settings-btn"
        >
          <Settings size={18} />
          Settings
        </button>
      </div>
    </div>
  );

  const renderRigidConfigPanel = () => {
    const isRecurringInstanceEdit =
      !!editingEvent && editingEvent.recurrence !== "none" && !!editingEvent.series_id;
    const recurrenceDisabled = isRecurringInstanceEdit && rigidEditScope === "instance";

    const handleRigidKeyDown = (e) => {
      if (e.key === "Delete") {
        const target = e.target;
        const isEditableField =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.tagName === "SELECT" ||
          target?.isContentEditable ||
          !!target?.closest?.('[contenteditable="true"]');

        if (!editingEvent || isEditableField) return;
        e.preventDefault();
        handleDeleteRigidEvent(isRecurringInstanceEdit ? rigidEditScope : "series");
        return;
      }

      if (e.key !== "Enter") return;
      if (e.target.tagName === "TEXTAREA" && e.shiftKey) return;
      if (e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
      e.preventDefault();
      handleSaveRigidEvent(isRecurringInstanceEdit ? rigidEditScope : "series");
    };

    return (
      <div ref={rigidPanelRef} className="flex flex-col flex-1" onKeyDown={handleRigidKeyDown} tabIndex={0} style={{ outline: "none" }} data-preserve-range-selection="true">
        <div className="flex-1 overflow-y-auto pr-2">
          <div className="form-group">
            <input
              type="text"
              className="form-input"
              placeholder="Item Name"
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              data-testid="event-title-input"
            />
          </div>

          <div className="form-group">
            <CollapsibleSectionHeader
              label="Description"
              expanded={isDescriptionExpanded}
              onToggle={() => setIsDescriptionExpanded(v => !v)}
              testId="description-toggle"
            />
            {isDescriptionExpanded && (
              <textarea
                className="form-input mt-2"
                placeholder="Add description (optional)"
                rows={2}
                value={eventForm.description}
                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                data-testid="event-description-input"
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Start</label>
            <input
              type="datetime-local"
              className="form-input"
              value={eventForm.start_time}
              onChange={(e) => setEventForm({ ...eventForm, start_time: e.target.value })}
              onBlur={(e) => {
                const start = e.target.value;
                if (!start) return;
                setEventForm(f => {
                  let next = f;
                  if (!f.end_time || start >= f.end_time) {
                    const endDate = new Date(start);
                    endDate.setHours(endDate.getHours() + 1);
                    next = { ...next, end_time: format(endDate, "yyyy-MM-dd'T'HH:mm") };
                  }
                  if (!f.recurrence_end_date) {
                    const repeatUntil = new Date(start);
                    repeatUntil.setFullYear(repeatUntil.getFullYear() + 1);
                    next = { ...next, recurrence_end_date: format(repeatUntil, "yyyy-MM-dd") };
                  }
                  return next;
                });
              }}
              data-testid="event-start-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">End</label>
            <input
              type="datetime-local"
              className="form-input"
              value={eventForm.end_time}
              onChange={(e) => setEventForm({ ...eventForm, end_time: e.target.value })}
              onBlur={(e) => {
                const end = e.target.value;
                if (end && eventForm.start_time && end <= eventForm.start_time) {
                  const startDate = new Date(end);
                  startDate.setHours(startDate.getHours() - 1);
                  setEventForm(f => ({ ...f, start_time: format(startDate, "yyyy-MM-dd'T'HH:mm") }));
                }
              }}
              data-testid="event-end-input"
            />
          </div>

          <div className="form-group">
            <CollapsibleSectionHeader
              label="Category"
              expanded={isCategoryExpanded}
              onToggle={() => setIsCategoryExpanded(v => !v)}
              testId="category-toggle"
            />
            {isCategoryExpanded && (
              <div className="mt-2">
                <Select
                  value={eventForm.category}
                  onValueChange={(value) => setEventForm({ ...eventForm, category: value })}
                >
                  <SelectTrigger className="rounded-none" data-testid="category-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="form-group">
            <CollapsibleSectionHeader
              label="Repeat"
              expanded={isRepeatExpanded}
              onToggle={() => setIsRepeatExpanded(v => !v)}
              testId="repeat-toggle"
            />
            {isRepeatExpanded && (
              <div
                className="mt-2"
                style={recurrenceDisabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
              >
                <Select
                  value={eventForm.recurrence}
                  onValueChange={(value) => {
                    if (recurrenceDisabled) return;
                    setEventForm({ ...eventForm, recurrence: value });
                  }}
                >
                  <SelectTrigger className="rounded-none" data-testid="recurrence-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {eventForm.recurrence !== "none" && (
                  <div className="mt-3">
                    <label className="form-label">Repeat Until</label>
                    <input
                      type="date"
                      className="form-input"
                      value={eventForm.recurrence_end_date}
                      onChange={(e) => setEventForm({ ...eventForm, recurrence_end_date: e.target.value })}
                      disabled={recurrenceDisabled}
                      data-testid="recurrence-end-input"
                    />
                    {recurrenceDisabled && (
                      <div className="text-xs text-gray-400 mt-1">Instance mode: recurrence rule is locked.</div>
                    )}
                  </div>
                )}

                {eventForm.recurrence === "weekly" && (
                  <div className="mt-3">
                    <label className="form-label">Repeat On</label>
                    <div style={{ display: "flex", gap: "4px" }} data-testid="recurrence-days-row">
                      {WEEKDAY_LABELS.map((label, i) => {
                        const isSelected = eventForm.days_of_week.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              if (recurrenceDisabled) return;
                              setEventForm((f) => ({
                                ...f,
                                days_of_week: isSelected
                                  ? f.days_of_week.filter((d) => d !== i)
                                  : [...f.days_of_week, i],
                              }));
                            }}
                            disabled={recurrenceDisabled}
                            data-testid={`recurrence-day-${i}`}
                            style={{
                              flex: 1,
                              padding: "6px 0",
                              fontSize: "12px",
                              fontWeight: 600,
                              border: "1px solid #E5E5E5",
                              background: isSelected ? "#0ea5e9" : "#FAFAFA",
                              color: isSelected ? "#ffffff" : "#737373",
                              cursor: recurrenceDisabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-group">
            <CollapsibleSectionHeader
              label="Timezone Mode"
              expanded={isTimezoneModeExpanded}
              onToggle={() => setIsTimezoneModeExpanded(v => !v)}
              testId="timezone-mode-toggle"
            />
            {isTimezoneModeExpanded && (
              <div style={{ display: "flex", flexDirection: "row", gap: "16px", marginTop: "8px", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "var(--foreground)" }}>
                  <input
                    type="radio"
                    name="timezone_mode"
                    value="absolute"
                    checked={eventForm.timezone_mode === "absolute"}
                    onChange={() => setEventForm({ ...eventForm, timezone_mode: "absolute" })}
                    style={{ cursor: "pointer" }}
                  />
                  Absolute
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "var(--foreground)" }}>
                  <input
                    type="radio"
                    name="timezone_mode"
                    value="naive"
                    checked={eventForm.timezone_mode === "naive"}
                    onChange={() => setEventForm({ ...eventForm, timezone_mode: "naive" })}
                    style={{ cursor: "pointer" }}
                  />
                  Naive
                </label>
              </div>
            )}
          </div>              
          
        </div>

        <div className="flex flex-col gap-2 mt-4">
          {isRecurringInstanceEdit && (
            <div className="flex items-center justify-between rounded-md border border-slate-600 bg-slate-900/70 p-1">
              <button
                className="flex-1 text-sm px-3 py-1 rounded"
                style={rigidEditScope === "instance" ? { background: "#0ea5e9", color: "#ffffff" } : { color: "#94a3b8" }}
                onClick={() => setRigidEditScope("instance")}
                data-testid="scope-instance-btn"
              >
                Instance
              </button>
              <button
                className="flex-1 text-sm px-3 py-1 rounded"
                style={rigidEditScope === "series" ? { background: "#0ea5e9", color: "#ffffff" } : { color: "#94a3b8" }}
                onClick={() => setRigidEditScope("series")}
                data-testid="scope-series-btn"
              >
                Series
              </button>
              <button
                className="flex-1 text-sm px-3 py-1 rounded"
                style={rigidEditScope === "now-and-future" ? { background: "#0ea5e9", color: "#ffffff" } : { color: "#94a3b8" }}
                onClick={() => setRigidEditScope("now-and-future")}
                data-testid="scope-future-btn"
              >
                Now & Future
              </button>
            </div>
          )}

          {rigidSaveError && (
            <div className="auth-error" data-testid="rigid-save-error">{rigidSaveError}</div>
          )}

          <div className="flex gap-2">
            {editingEvent && (
              <button
                className="delete-btn flex-1"
                onClick={() => handleDeleteRigidEvent(isRecurringInstanceEdit ? rigidEditScope : "series")}
                data-testid="delete-event-btn"
              >
                Delete
              </button>
            )}

            <button
              className="add-event-btn flex-1"
              onClick={() => handleSaveRigidEvent(isRecurringInstanceEdit ? rigidEditScope : "series")}
              data-testid="save-event-btn"
            >
              {"Save"}
            </button>

            <button
              className="delete-btn flex-1"
              onClick={handleCancelConfig}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderFlexConfigPanel = () => {
    const handleFlexKeyDown = (e) => {
      if (e.key === "Delete") {
        const target = e.target;
        const isEditableField =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.tagName === "SELECT" ||
          target?.isContentEditable ||
          !!target?.closest?.('[contenteditable="true"]');

        if (isNewFlexItem || !editingFlexEvent || isEditableField) return;
        e.preventDefault();
        handleDeleteFlexEvent();
        return;
      }

      if (e.key !== "Enter") return;
      if (e.target.tagName === "TEXTAREA" && e.shiftKey) return;
      if (e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
      e.preventDefault();
      handleSaveFlexEvent();
    };
    return (
    <div ref={flexPanelRef} className="flex flex-col flex-1" onKeyDown={handleFlexKeyDown} tabIndex={0} style={{ outline: "none" }}>
      <div className="flex-1 overflow-y-auto pr-2">
        <div className="form-group">
          <input
            type="text"
            className="form-input"
            placeholder="Item Name"
            value={flexForm.name}
            onChange={handleFlexNameChange}
            data-testid="flex-name-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Duration (minutes)</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="form-input flex-1"
              placeholder="60"
              value={flexForm.duration}
              onChange={handleFlexDurationChange}
              data-testid="flex-duration-input"
            />
            <div className="flex flex-col gap-1">
              <button
                className="step-btn"
                onClick={handleStepUp}
                data-testid="step-up-btn"
              >
                ▲
              </button>
              <button
                className="step-btn"
                onClick={handleStepDown}
                data-testid="step-down-btn"
              >
                ▼
              </button>
            </div>
          </div>
        </div>

        <div className="form-group flex-priority-row">
          <label className="form-label">Priority</label>
          <select
            className="form-input"
            value={flexForm.priority}
            onChange={handleFlexPriorityChange}
            data-testid="flex-priority-select"
          >
            <option value={1}>1 - Critical</option>
            <option value={2}>2 - High</option>
            <option value={3}>3 - Medium</option>
            <option value={4}>4 - Low</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Deadline</label>
          <input
            type="datetime-local"
            className="form-input"
            value={flexForm.deadline}
            // Dates before today, and times today earlier than
            // now + min_duration, are disabled by the min attribute below --
            // the earliest pickable deadline always leaves enough room for
            // the task to theoretically start and run (Task Deadlines Part 1).
            min={utcIsoToTzLocal(
              new Date(Date.now() + globalSettings.minDuration * 60000).toISOString(),
              globalSettings.timezone
            )}
            onChange={handleFlexDeadlineChange}
            data-testid="flex-deadline-input"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        {!isNewFlexItem && editingFlexEvent && (
          <button
            className="delete-btn flex-1"
            onClick={handleDeleteFlexEvent}
            data-testid="delete-flex-btn"
          >
            Delete
          </button>
        )}

        <button
          className="add-event-btn flex-1"
          onClick={handleSaveFlexEvent}
          disabled={isSavingFlexEvent}
          aria-busy={isSavingFlexEvent}
          data-testid="save-flex-btn"
        >
          {isSavingFlexEvent ? "Saving…" : "Save"}
        </button>

        <button
          className="delete-btn flex-1"
          onClick={handleCancelConfig}
        >
          Cancel
        </button>
      </div>
    </div>
    );
  };

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handleSaveSettings = useCallback(async () => {
    const minDurationValue = settingsForm.minDuration === "" ? 15 : parseInt(settingsForm.minDuration) || 15;
    const newSettings = {
      minDuration: minDurationValue,
      timezone: getEffectiveTimezone(settingsForm.timezone),
    };
    setGlobalSettings(newSettings);
    try {
      await axios.put(`${API}/settings`, {
        min_duration: newSettings.minDuration,
        timezone: newSettings.timezone,
      });
    } catch (error) {
      console.error("Failed to persist settings:", error);
    }
    setPanelMode("idle");
  }, [settingsForm]);

  // Keyboard shortcut: Enter to save in settings panel
  useEffect(() => {
  if (panelMode !== "settings") return;
  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSaveSettings();
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [panelMode, handleSaveSettings]);

  // Task Deadlines Part 1 -- deadline badge display. User-facing and must
  // respect the app's configured timezone, matching FlexTooltip's convention.
  const formatDeadlineBadge = (isoString) => {
    const tz = getEffectiveTimezone(globalSettings.timezone);
    return new Date(isoString).toLocaleString("en-US", {
      timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  };

  const renderSettingsPanel = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <button
          className="settings-close-btn"
          onClick={() => setPanelMode("idle")}
          data-testid="settings-close-btn"
        >
          <X size={18} />
        </button>
      </div>

      <div className="settings-panel-scroll">
        {/* Timezone */}
        <div className="form-group">
          <label className="form-label">Timezone</label>
          <select
            className="form-input"
            value={settingsForm.timezone}
            onChange={(e) => setSettingsForm(prev => ({ ...prev, timezone: e.target.value }))}
            data-testid="timezone-select"
          >
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>

        {/* Min Duration Section */}
        <div className="form-group">
          <label className="form-label">Min Duration</label>
          <input
            type="text"
            className="form-input"
            placeholder="15"
            value={settingsForm.minDuration}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9]/g, '');
              setSettingsForm(prev => ({ ...prev, minDuration: value }));
            }}
            data-testid="global-min-duration"
          />
          <div className="settings-note">
            Applies to all flex items
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button
          className="delete-btn settings-action-btn"
          onClick={() => setPanelMode("idle")}
        >
          Cancel
        </button>
        <button
          className="add-event-btn settings-action-btn"
          onClick={handleSaveSettings}
          data-testid="save-settings-btn"
        >
          Save
        </button>
      </div>
    </div>
  );

  const renderSidebarContent = () => {
    switch (panelMode) {
      case "idle":
        return renderIdlePanel();
      case "rigid-config":
        return renderRigidConfigPanel();
      case "flex-config":
        return renderFlexConfigPanel();
      case "settings":
        return renderSettingsPanel();
      case "calendar-create":
        return renderCalendarCreatePanel();
      case "calendar-config":
        return renderCalendarConfigPanel();
      default:
        return renderIdlePanel();
    }
  };

  const getPanelModeTitle = (mode) => {
    switch (mode) {
      case "rigid-config": return editingEvent ? "Edit Event" : "New Event";
      case "flex-config": return editingFlexEvent && !isNewFlexItem ? "Edit Task" : "New Task";
      case "settings": return "Settings";
      case "calendar-create": return "New Calendar";
      case "calendar-config": {
        const cal = calendars.find((c) => c.id === configCalendarId);
        return cal ? cal.name : "Calendar";
      }
      default: return null; // idle: no title — toggle + calendar list already give context
    }
  };

  // Persistent calendar list — a sibling of renderSidebarContent(), not a
  // branch inside it, so it survives panelMode changes (opening/closing a
  // form does not unmount it, and its checked/expanded state lives at the
  // App level alongside `calendars` itself, not as local state here).
  const handleDeleteCalendarClick = (cal) => {
    setDeleteCalendarError(null);
    setDeletingCalendar(cal);
  };

  // Toggles a calendar's membership on the event being created/edited.
  // Remembers the choice (lastFormCalendarIds) so the next new event
  // defaults to it, and -- since assigning an event to a calendar implies
  // wanting to see it -- auto-checks that calendar's visibility too.
  // Un-checking membership does not auto-hide, so it never hides unrelated
  // existing events the user still wants visible.
  const toggleFormCalendarMembership = (calId) => {
    setFormCalendarIds((prev) => {
      const isMember = prev.includes(calId);
      const next = isMember ? prev.filter((id) => id !== calId) : [...prev, calId];
      setLastFormCalendarIds(next);
      if (!isMember) {
        // Auto-check lands on the highest state this viewer's permission
        // allows (mirroring "on" everywhere else in this file), not just
        // the minimum "visible" state -- matches what a fresh eye toggle
        // click would land on too.
        setCalendarEyeStates((prev) => {
          if ((prev[calId] ?? 0) > 0) return prev;
          const cal = calendars.find((c) => c.id === calId);
          return { ...prev, [calId]: cal ? calendarEyeCap(cal) : 2 };
        });
      }
      return next;
    });
  };

  // The currently selected control, as an icon. Just-looking has only one
  // control (eye); tasks-queue has two, chosen by matrixKind. Both
  // selector-row toggles show this same icon so the coordinate→row-icon
  // association is taught in place.
  const renderMatrixCellIcon = () => {
    if (matrixLayer === "just-looking") return <Eye size={13} />;
    return matrixKind === "availability" ? <SquaresIntersect size={13} /> : <Waves size={13} />;
  };

  // Availability Matrix Phase 2: all four toggles now persist server-side
  // via PUT /calendars/{id}/view-prefs on top of the
  // existing optimistic local-state flip. Fire-and-forget, matching this
  // file's existing convention for non-blocking persistence calls (e.g. the
  // openBlocks refresh effect) -- a failed PUT logs but doesn't roll back
  // the click; the next full calendars refetch will reconcile either way.
  const persistCalendarViewPref = (calendarId, field, value) => {
    axios.put(`${API}/calendars/${calendarId}/view-prefs`, { [field]: value })
      .catch((error) => console.error(`Failed to persist ${field} for calendar ${calendarId}:`, error));
  };

  // Staged Calendar Editing -- the row's own matrix cell stays immediate-
  // persist (see the four renderers below), but clicking it for the same
  // calendar a calendar-config draft is currently open on now writes real
  // state out from under that draft's snapshot. Rather than let the draft
  // silently go stale, treat this exactly like any other click-away:
  // discard it, no confirmation -- the row's click already did its own
  // real, immediate write regardless.
  const discardStaleConfigDraftIfMatching = (calendarId) => {
    if (calendarId === configCalendarId && panelMode === "calendar-config") {
      setPanelMode("idle");
      setConfigCalendarId(null);
    }
  };

  // True when no calendar OTHER than calendarId currently has wave=true.
  // flowAroundCalendarIds is already
  // derived from every calendar this user can see (owned + shared, see the
  // effect that builds it from the full `calendars` fetch), so this needs
  // no separate visible-calendar lookup. Deliberately excludes calendarId
  // itself from the check regardless of its own current membership, so it
  // works the same way whether the caller is the row (live state) or the
  // calendar-config panel (a draft whose value may not match the last
  // persisted one yet).
  const wouldLeaveNoWaveCalendars = (calendarId) =>
    !flowAroundCalendarIds.some((id) => id !== calendarId);

  const showWaveGuardMessage = (calendarId) => {
    if (waveGuardTimeoutRef.current) clearTimeout(waveGuardTimeoutRef.current);
    setWaveGuardMessage({ calendarId, text: "At least one must be checked" });
    waveGuardTimeoutRef.current = setTimeout(() => setWaveGuardMessage(null), 2500);
  };

  // Availability Matrix Phase 4 -- each cell's control is its own named
  // renderer (rather than one function branching on the selected cell) so
  // the calendar-config panel can render all four at once, alongside the
  // row's existing single-cell dispatcher below. `prefix` lets a caller
  // avoid a testid collision when both are on screen for the same
  // calendar at once -- defaults preserve every existing testid exactly.
  //
  // Staged Calendar Editing -- `draftOverride`, when passed as
  // `{ value, onToggle }`, redirects the control to read/write a draft
  // field instead of live global state and calling persistCalendarViewPref
  // immediately. The row's own single-cell view (renderCalendarMatrixControl,
  // below) never passes this, so it stays exactly as immediate-persist as
  // before; only calendar-config's full 2x2 grid passes draft overrides.
  const renderWaveControl = (cal, prefix = "calendar-wave", draftOverride = null) => {
    const on = draftOverride ? draftOverride.value : flowAroundCalendarIds.includes(cal.id);
    const onClick = () => {
      if (on && wouldLeaveNoWaveCalendars(cal.id)) {
        showWaveGuardMessage(cal.id);
        return;
      }
      if (draftOverride) {
        draftOverride.onToggle(!on);
      } else {
        setFlowAroundCalendarIds((prev) =>
          on ? prev.filter((id) => id !== cal.id) : [...prev, cal.id]
        );
        persistCalendarViewPref(cal.id, "wave", !on);
        discardStaleConfigDraftIfMatching(cal.id);
      }
    };
    return (
      <button
        type="button"
        className="calendar-row-matrix-btn calendar-row-wave-btn"
        onClick={onClick}
        aria-pressed={on}
        aria-label={on
          ? `Stop flowing around ${cal.name}'s closed blocks`
          : `Flow around ${cal.name}'s closed blocks`}
        data-testid={`${prefix}-${cal.id}`}
      >
        <Waves size={14} />
      </button>
    );
  };

  const renderIntersectControl = (cal, prefix = "calendar-intersect", draftOverride = null) => {
    const on = draftOverride ? draftOverride.value : intersectCalendarIds.includes(cal.id);
    const onClick = draftOverride
      ? () => draftOverride.onToggle(!on)
      : () => {
          setIntersectCalendarIds((prev) =>
            on ? prev.filter((id) => id !== cal.id) : [...prev, cal.id]
          );
          persistCalendarViewPref(cal.id, "intersect", !on);
          discardStaleConfigDraftIfMatching(cal.id);
        };
    return (
      <button
        type="button"
        className="calendar-row-matrix-btn calendar-row-intersect-btn"
        onClick={onClick}
        aria-pressed={on}
        aria-label={on
          ? `Stop intersecting ${cal.name}'s open blocks into availability`
          : `Intersect ${cal.name}'s open blocks into availability`}
        data-testid={`${prefix}-${cal.id}`}
      >
        <SquaresIntersect size={14} />
      </button>
    );
  };

  // just-looking:busy-blocks — the eye toggle, tri-state as of
  // Availability Matrix Phase 3: 0 off / 1 blocks-only (no title, not
  // clickable) / 2 full (today's original behavior). Capped per-calendar
  // at calendarEyeCap; (state + 1) % (cap + 1) degrades the ordinary
  // 0->1->2->0 cycle into a 0->1->0 cycle on a capped calendar with no
  // special-cased branch -- there is no "blocked" click here, every
  // click performs a real transition, so this deliberately does NOT use
  // aria-disabled (reserved for a control that's genuinely inert, like
  // add-event-btn's no-write-access guard -- that pattern doesn't fit a
  // control that always does something).
  const renderEyeControl = (cal, prefix = "calendar-eye", draftOverride = null) => {
    const state = draftOverride ? draftOverride.value : (calendarEyeStates[cal.id] ?? 0);
    const cap = calendarEyeCap(cal);
    const desired = (state + 1) % (cap + 1);
    // The moment a capped viewer might expect a third state: they're at 1
    // (blocks-only) and click again. On an uncapped calendar this reaches
    // 2; here it can't, so it wraps to 0 same as any other capped click --
    // a normal, correct transition. The note alongside it is information
    // about their permission level, not a disabled-control affordance.
    const showEyeNote = state === 1 && cap === 1;
    const eyeIcon = state === 2 ? <Eye size={14} /> : state === 1 ? <EyeClosed size={14} /> : <EyeOff size={14} />;
    const eyeAriaLabel = state === 2
      ? `Hide ${cal.name} events on the grid`
      : state === 1
      ? `Show ${cal.name} event titles on the grid`
      : `Show ${cal.name} events as blocks on the grid`;
    const onClick = draftOverride
      ? () => draftOverride.onToggle(desired)
      : () => {
          setCalendarEyeStates((prev) => ({ ...prev, [cal.id]: desired }));
          persistCalendarViewPref(cal.id, "eye", desired);
          if (showEyeNote) {
            setEyeNoteCalendarIds((prev) => new Set(prev).add(cal.id));
          }
          discardStaleConfigDraftIfMatching(cal.id);
        };
    return (
      <>
        <button
          type="button"
          className="calendar-row-matrix-btn calendar-row-eye-btn"
          onClick={onClick}
          aria-pressed={state === 2 ? "true" : state === 1 ? "mixed" : "false"}
          data-eye-state={state}
          aria-label={eyeAriaLabel}
          data-testid={`${prefix}-${cal.id}`}
        >
          {eyeIcon}
        </button>
        {!draftOverride && eyeNoteCalendarIds.has(cal.id) && cap < 2 && (
          <span className="calendar-eye-permission-note" data-testid={`${prefix}-permission-note-${cal.id}`}>
            You don't have permission to view event names on this calendar. Contact {cal.owner_email || "the owner"}.
          </span>
        )}
      </>
    );
  };

  // The single per-calendar control for the selected cell -- the row's
  // always-visible, single-cell view. Same data-testid, same aria-pressed
  // semantics as before this was split into named sub-renderers above; the
  // calendar-config panel calls those directly to show all of them at once
  // instead of just the selected cell. Just-looking has only one control
  // (eye) regardless of matrixKind; tasks-queue chooses between wave and
  // intersect by matrixKind.
  const renderCalendarMatrixControl = (cal) => {
    if (matrixLayer === "just-looking") return renderEyeControl(cal);
    return matrixKind === "availability" ? renderIntersectControl(cal) : renderWaveControl(cal);
  };

  // Availability Matrix Phase 4 -- the thin first step of calendar
  // creation: name + color only, same validation as the inline form this
  // replaces. On success it hands straight off to calendar-config for the
  // new id (createCalendar now returns the created calendar) rather than
  // just closing -- there's no separate "just created" panel variant.
  // Cancel here has nothing to clean up: nothing was created yet.
  const renderCalendarCreatePanel = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <button
          className="settings-close-btn"
          onClick={() => { setPanelMode("idle"); setNewCalendarName(""); setAddCalendarError(null); }}
          data-testid="calendar-create-close-btn"
        >
          <X size={18} />
        </button>
      </div>
      <div className="settings-panel-scroll" data-testid="calendar-create-panel">
        {addCalendarError && (
          <div className="auth-error" data-testid="add-calendar-error">{addCalendarError}</div>
        )}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            type="text"
            className="form-input"
            placeholder="Calendar name"
            value={newCalendarName}
            autoFocus
            onChange={(e) => setNewCalendarName(e.target.value)}
            data-testid="new-calendar-name-input"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Color</label>
          <input
            type="color"
            value={newCalendarColor}
            onChange={(e) => setNewCalendarColor(e.target.value)}
            data-testid="new-calendar-color-input"
          />
        </div>
      </div>
      <div className="settings-actions">
        <button
          className="delete-btn settings-action-btn"
          onClick={() => { setPanelMode("idle"); setNewCalendarName(""); setAddCalendarError(null); }}
          data-testid="cancel-new-calendar-btn"
        >
          Cancel
        </button>
        <button
          className="add-event-btn settings-action-btn"
          onClick={async () => {
            if (!newCalendarName.trim()) return;
            const result = await createCalendar(newCalendarName.trim(), newCalendarColor);
            if (result.ok) {
              setNewCalendarName("");
              setAddCalendarError(null);
              setConfigCalendarId(result.calendar.id);
              setPanelMode("calendar-config");
            } else {
              setAddCalendarError(result.message);
            }
          }}
          data-testid="save-new-calendar-btn"
        >
          Create
        </button>
      </div>
    </div>
  );

  const handleCancelCalendarConfig = () => {
    // The draft-lifecycle effect (near buildCalendarConfigDraft) discards
    // calendarConfigDraft the instant panelMode leaves "calendar-config" --
    // nothing here was ever sent to the backend, so there's nothing to
    // undo. Used by both the Cancel button and every click-away case
    // (another gear, "+ New calendar", another task/event, the grid
    // background) that already sets panelMode/configCalendarId elsewhere.
    setPanelMode("idle");
    setConfigCalendarId(null);
  };

  // Staged Calendar Editing -- diffs calendarConfigDraft against the
  // snapshot taken when the panel opened, fires one call per group that
  // actually changed (all in parallel, no cross-field atomicity -- matches
  // this panel's behavior before this feature, just now visible in one
  // batched moment), and only closes the panel if every one of them
  // succeeded.
  const handleSaveCalendarConfig = async () => {
    const draft = calendarConfigDraft;
    const original = originalCalendarConfigDraftRef.current;
    const cal = calendars.find((c) => c.id === configCalendarId);
    if (!draft || !original || !cal) return;
    const isOwner = cal.is_owner;

    const tasks = [];

    const patchFields = {};
    if (isOwner && draft.name !== original.name) patchFields.name = draft.name;
    if (isOwner && draft.color !== original.color) patchFields.color = draft.color;
    if (Object.keys(patchFields).length > 0) {
      tasks.push({ key: "calendar", promise: updateCalendar(cal.id, patchFields) });
    }

    const viewPrefFields = {};
    if (draft.eye !== original.eye) viewPrefFields.eye = draft.eye;
    if (draft.wave !== original.wave) viewPrefFields.wave = draft.wave;
    if (draft.intersect !== original.intersect) viewPrefFields.intersect = draft.intersect;
    if (!isOwner && draft.color !== original.color) viewPrefFields.color = draft.color;
    if (Object.keys(viewPrefFields).length > 0) {
      tasks.push({
        key: "view-prefs",
        promise: axios.put(`${API}/calendars/${cal.id}/view-prefs`, viewPrefFields)
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, message: error.response?.data?.detail || "Failed to save matrix/color" })),
      });
    }

    const unitsChanged = isOwner && JSON.stringify(draft.units || []) !== JSON.stringify(original.units || []);
    if (unitsChanged) {
      tasks.push({
        key: "open-blocks",
        promise: axios.put(`${API}/calendars/${cal.id}/open-blocks`, { blocks: flattenUnitsToRows(draft.units) })
          .then((response) => ({ ok: true, data: response.data }))
          .catch((error) => ({ ok: false, message: error.response?.data?.detail || "Failed to save availability" })),
      });
    }

    (draft.pendingShareActions || [])
      .filter((a) => a.status !== "success")
      .forEach((action) => {
        tasks.push(
          action.type === "add"
            ? { key: `share-${action.id}`, actionId: action.id, promise: shareCalendarWithUser(cal.id, action.payload) }
            : { key: `share-${action.id}`, actionId: action.id, promise: removeCalendarAccess(cal.id, action.payload.accessId) }
        );
      });

    if (tasks.length === 0) {
      handleCancelCalendarConfig();
      return;
    }

    setCalendarConfigSaveState({ saving: true, fieldErrors: {} });
    const settled = await Promise.allSettled(tasks.map((t) => t.promise));

    let anyFailure = false;
    let unitsResult = null;
    const shareResultsByActionId = {};
    const fieldErrors = {};
    settled.forEach((result, i) => {
      const task = tasks[i];
      // shareCalendarWithUser/removeCalendarAccess/updateCalendar all
      // catch internally and resolve { ok, message } rather than
      // rejecting -- Promise.allSettled still calls that "fulfilled", so
      // the real outcome is .value.ok, not the settle status.
      const value = result.status === "fulfilled" ? result.value : { ok: false, message: result.reason?.message };
      if (task.actionId) shareResultsByActionId[task.actionId] = value;
      if (task.key === "open-blocks" && value.ok) unitsResult = value.data;
      if (!value.ok) {
        anyFailure = true;
        // Share-action failures surface inline on their own pending row
        // (below) instead of here -- fieldErrors is only for the three
        // non-share groups.
        if (!task.actionId) fieldErrors[task.key] = value.message || "Failed to save";
      }
    });
    setCalendarConfigSaveState({ saving: false, fieldErrors });

    // Mark each share action's outcome. A succeeded one gets "success" so
    // a later Save never re-POSTs it; a failed "add" gets its error
    // attached and stays editable (see stageShareAdd/editShareAction) --
    // an invalid-email failure fails the exact same way on an unmodified
    // retry, so it's not just requeued silently. A failed "remove" simply
    // stays "pending" for automatic retry -- there's no payload to correct.
    if (Object.keys(shareResultsByActionId).length > 0) {
      setCalendarConfigDraft((prev) => {
        if (!prev) return prev;
        const pendingShareActions = (prev.pendingShareActions || []).map((a) => {
          const outcome = shareResultsByActionId[a.id];
          if (!outcome) return a;
          return outcome.ok ? { ...a, status: "success", error: null } : { ...a, status: "error", error: outcome.message || "Failed" };
        });
        return { ...prev, pendingShareActions };
      });
    }
    // A failed add must not linger as an optimistic roster row --
    // remounting CalendarRosterPanel makes it refetch the real roster,
    // which correctly omits anything that was never actually persisted.
    setRosterRefreshNonce((n) => n + 1);

    if (anyFailure) {
      // Leave the panel open. Fields/actions that did succeed already
      // reflect their new state (calendars refetched by updateCalendar,
      // pendingShareActions updated above) -- no reason to revert them,
      // matching this panel's pre-existing zero cross-field atomicity.
      return;
    }

    // Full success -- apply the draft's remaining values into real state in
    // one batch, then close. React batches these, so the existing
    // flex-placement effect (depends on intersect/flowAround ids and
    // openBlockRowsVersion) fires exactly once no matter how many fields
    // changed here.
    if (viewPrefFields.eye !== undefined) setCalendarEyeStates((prev) => ({ ...prev, [cal.id]: draft.eye }));
    if (viewPrefFields.wave !== undefined) {
      setFlowAroundCalendarIds((prev) => (draft.wave ? (prev.includes(cal.id) ? prev : [...prev, cal.id]) : prev.filter((id) => id !== cal.id)));
    }
    if (viewPrefFields.intersect !== undefined) {
      setIntersectCalendarIds((prev) => (draft.intersect ? (prev.includes(cal.id) ? prev : [...prev, cal.id]) : prev.filter((id) => id !== cal.id)));
    }
    if (!isOwner && viewPrefFields.color !== undefined) {
      setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, color: draft.color } : c)));
    }
    if (unitsResult) {
      setOpenBlocksByCalendar((prev) => ({ ...prev, [cal.id]: unitsResult.blocks }));
      setOpenBlocksDraftByCalendar((prev) => ({ ...prev, [cal.id]: groupRowsIntoUnits(unitsResult.blocks) }));
      setOpenBlockRowsVersion((v) => v + 1);
    }

    setPanelMode("idle");
    setConfigCalendarId(null);
  };

  // Availability Matrix Phase 4 -- the consolidated per-calendar panel the
  // gear opens (was a Dialog housing only sharing/roster; now a panelMode
  // housing everything the row used to spread across pencil/share/gear/
  // color-input/rename-click/delete/expand). Every viewer can open it, not
  // just an owner -- what's actually shown is gated per-section below,
  // mirroring the row's old `cal.is_owner &&` convention rather than
  // graying anything out. The matrix is already per-viewer regardless of
  // ownership; Availability is owner-editable / non-owner read-only
  // (PUT /open-blocks is owner-only server-side -- an editable form for a
  // non-owner would just reproduce that 404 in a new place); Sharing and
  // Rename are owner-only outright; Color is everyone, just a different
  // write path depending on role; Delete keeps its existing relabel.
  //
  // Staged Calendar Editing -- everything below reads/writes
  // calendarConfigDraft, not live state; nothing here persists until Save.
  const renderCalendarConfigPanel = () => {
    const cal = calendars.find((c) => c.id === configCalendarId);
    if (!cal) return null;
    const draft = calendarConfigDraft;
    if (!draft) return null; // one-frame gap between panelMode flipping and the draft-init effect committing
    const isOwner = cal.is_owner;
    const { fieldErrors, saving } = calendarConfigSaveState;
    const draftSetter = (patch) => setCalendarConfigDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    const eyeOverride = { value: draft.eye, onToggle: (v) => draftSetter({ eye: v }) };
    const waveOverride = { value: draft.wave, onToggle: (v) => draftSetter({ wave: v }) };
    const intersectOverride = { value: draft.intersect, onToggle: (v) => draftSetter({ intersect: v }) };
    const failedShareAdds = (draft.pendingShareActions || []).filter((a) => a.type === "add" && a.status === "error");
    // Non-owner's Availability stays read-only, so it reads live persisted
    // state directly rather than the draft -- nothing here is ever edited,
    // so there's nothing to stage.
    const readOnlyUnits = openBlocksDraftByCalendar[cal.id] || [];
    return (
      <div className="settings-panel">
        <div className="settings-panel-scroll" data-testid="calendar-config-panel">
          <div className="form-group">
            <label className="form-label">Availability matrix</label>
            <div className="calendar-config-matrix-grid">
              <div className="calendar-config-matrix-corner" />
              <div className="calendar-config-matrix-col-label">Events</div>
              <div className="calendar-config-matrix-col-label">Availability</div>
              <div className="calendar-config-matrix-row-label">Just Looking</div>
              <div className="calendar-config-matrix-cell">{renderEyeControl(cal, "calendar-config-eye", eyeOverride)}</div>
              <div className="calendar-config-matrix-cell" />
              <div className="calendar-config-matrix-row-label">Task Queue</div>
              <div className="calendar-config-matrix-cell">{renderWaveControl(cal, "calendar-config-wave", waveOverride)}</div>
              <div className="calendar-config-matrix-cell">{renderIntersectControl(cal, "calendar-config-intersect", intersectOverride)}</div>
            </div>
            {(waveGuardMessage?.calendarId === cal.id || fieldErrors["view-prefs"]) && (
              <div className="calendar-config-field-error" data-testid={`calendar-config-view-prefs-error-${cal.id}`}>
                <AlertTriangle size={12} /> {waveGuardMessage?.calendarId === cal.id ? waveGuardMessage.text : fieldErrors["view-prefs"]}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Availability</label>
            {isOwner ? (
              <div className="open-blocks-editor" data-testid={`open-blocks-editor-${cal.id}`}>
                {(draft.units || []).map((unit, unitIndex) => (
                  <div key={unitIndex} className="open-blocks-unit" data-testid={`open-blocks-unit-${cal.id}-${unitIndex}`}>
                    <div className="open-blocks-unit-row1">
                      <input
                        type="time"
                        className="open-blocks-time-input"
                        value={unit.start_time}
                        onChange={(e) => handleUnitTimeChange(cal.id, unitIndex, "start_time", e.target.value)}
                        onBlur={() => handleUnitTimeBlur(cal.id, unitIndex, "start_time")}
                        data-testid={`open-blocks-unit-start-${cal.id}-${unitIndex}`}
                      />
                      <span className="open-blocks-time-sep">to</span>
                      <input
                        type="time"
                        className="open-blocks-time-input"
                        value={unit.end_time}
                        onChange={(e) => handleUnitTimeChange(cal.id, unitIndex, "end_time", e.target.value)}
                        onBlur={() => handleUnitTimeBlur(cal.id, unitIndex, "end_time")}
                        data-testid={`open-blocks-unit-end-${cal.id}-${unitIndex}`}
                      />
                      <button
                        type="button"
                        className="open-blocks-unit-delete-btn"
                        onClick={() => handleDeleteUnit(cal.id, unitIndex)}
                        aria-label="Delete this window"
                        data-testid={`open-blocks-unit-delete-${cal.id}-${unitIndex}`}
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <div className="open-blocks-unit-row2 day-checkboxes">
                      {DAY_LABELS.map((day, dayIndex) => {
                        const isBookend = dayIndex === 0 || dayIndex === 6;
                        return (
                          <label key={day} className="day-checkbox-label">
                            <input
                              type="checkbox"
                              className="day-checkbox"
                              checked={unit.days[dayIndex]}
                              onChange={() => handleToggleUnitDay(cal.id, unitIndex, dayIndex)}
                              data-testid={`open-blocks-unit-day-${cal.id}-${unitIndex}-${dayIndex}`}
                            />
                            <span className={`day-checkbox-text ${unit.days[dayIndex] ? "active" : ""}`}>
                              {isBookend ? day : (
                                <>
                                  <span className="open-blocks-day-full">{day}</span>
                                  <span className="open-blocks-day-compact">{WEEKDAY_LABELS[dayIndex]}</span>
                                </>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="open-blocks-add-unit-btn"
                  onClick={() => handleAddUnit(cal.id)}
                  data-testid={`open-blocks-add-unit-${cal.id}`}
                >
                  <Plus size={12} /> Add window
                </button>
                {fieldErrors["open-blocks"] && (
                  <div className="calendar-config-field-error" data-testid={`calendar-config-open-blocks-error-${cal.id}`}>
                    <AlertTriangle size={12} /> {fieldErrors["open-blocks"]}
                  </div>
                )}
              </div>
            ) : (
              <div className="open-blocks-editor open-blocks-readonly" data-testid={`open-blocks-editor-${cal.id}`}>
                {readOnlyUnits.length === 0 ? (
                  <div className="open-blocks-readonly-empty">No availability set.</div>
                ) : (
                  readOnlyUnits.map((unit, unitIndex) => {
                    const activeDays = DAY_LABELS.filter((_, i) => unit.days[i]);
                    return (
                      <div key={unitIndex} className="open-blocks-unit open-blocks-unit-readonly" data-testid={`open-blocks-unit-${cal.id}-${unitIndex}`}>
                        {activeDays.length > 0
                          ? `${activeDays.join(", ")}: ${unit.start_time}–${unit.end_time}`
                          : `${unit.start_time}–${unit.end_time} (no days selected)`}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {isOwner && (
            <div className="form-group">
              <label className="form-label">Sharing</label>
              <CalendarRosterPanel
                key={`${cal.id}-${rosterRefreshNonce}`}
                calendarId={cal.id}
                fetchRoster={fetchCalendarRoster}
                onShare={(calId, payload) => stageShareAdd(calId, payload)}
                onRemove={(calId, accessId) => stageShareRemove(calId, accessId)}
                onResend={resendShareInvite}
              />
              {failedShareAdds.map((action) => (
                <div key={action.id} className="calendar-config-pending-share-failure" data-testid={`calendar-config-share-failure-${action.id}`}>
                  <input
                    type="email"
                    className="form-input"
                    value={action.payload.email}
                    onChange={(e) => editShareAction(action.id, e.target.value)}
                    data-testid={`calendar-config-share-failure-email-${action.id}`}
                  />
                  <span className="calendar-config-field-error" data-testid={`calendar-config-share-failure-message-${action.id}`}>
                    <AlertTriangle size={12} /> {action.error}
                  </span>
                  <button
                    type="button"
                    className="calendar-config-pending-share-discard-btn"
                    onClick={() => discardShareAction(action.id)}
                    aria-label="Discard this invite"
                    data-testid={`calendar-config-share-failure-discard-${action.id}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                type="text"
                className="form-input"
                value={draft.name}
                onChange={(e) => draftSetter({ name: e.target.value })}
                data-testid={`calendar-rename-input-${cal.id}`}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Color</label>
            <input
              type="color"
              className="calendar-row-color-input"
              value={draft.color || DEFAULT_CALENDAR_COLOR}
              onChange={(e) => draftSetter({ color: e.target.value })}
              data-testid={`calendar-color-input-${cal.id}`}
              title="Calendar color"
            />
            {fieldErrors["calendar"] && (
              <div className="calendar-config-field-error" data-testid={`calendar-config-calendar-error-${cal.id}`}>
                <AlertTriangle size={12} /> {fieldErrors["calendar"]}
              </div>
            )}
          </div>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="calendar-row-delete-btn"
            onClick={() => handleDeleteCalendarClick(cal)}
            disabled={isOwner && ownedCalendarCount <= 1}
            data-testid={`calendar-delete-${cal.id}`}
            aria-label={isOwner ? "Delete calendar" : "Remove shared calendar"}
          >
            <X size={12} /> {isOwner ? "Delete calendar" : "Stop viewing this shared calendar"}
          </button>
          <button
            className="delete-btn settings-action-btn"
            onClick={handleCancelCalendarConfig}
            disabled={saving}
            data-testid="calendar-config-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="add-event-btn settings-action-btn"
            onClick={handleSaveCalendarConfig}
            disabled={saving}
            data-testid="calendar-config-save-btn"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  };

  const renderCalendarList = () => {
    return (
    <div className="calendar-list" data-testid="calendar-list">
      <CollapsibleSectionHeader
        label="Calendars"
        expanded={isCalendarListExpanded}
        onToggle={() => setIsCalendarListExpanded((prev) => !prev)}
        testId="calendar-list-toggle"
      />
      {isCalendarListExpanded && (
        <>
        <div className="availability-matrix-selector" data-testid="availability-matrix-selector">
          <div className="availability-matrix-toggles">
            <button
              type="button"
              className="availability-matrix-toggle"
              data-testid="availability-matrix-layer-toggle"
              data-value={matrixLayer}
              onClick={() => setMatrixLayer((p) => (p === "just-looking" ? "tasks-queue" : "just-looking"))}
              aria-label={matrixLayer === "just-looking"
                ? "Layer: just looking — these controls only change what's drawn on the grid. Click to switch to tasks queue."
                : "Layer: tasks queue — these controls change where your tasks are placed. Click to switch to just looking."}
              title={matrixLayer === "just-looking"
                ? "Just looking — the per-calendar control below only changes what's drawn on the grid; the task queue is untouched. Click to switch to Tasks queue."
                : "Tasks queue — the per-calendar control below changes where your tasks get placed. Click to switch to Just looking."}
            >
              {renderMatrixCellIcon()}
              <span className="availability-matrix-toggle-word">
                {matrixLayer === "just-looking" ? "just looking" : "tasks queue"}
              </span>
            </button>
            {matrixLayer === "tasks-queue" && (
              <button
                type="button"
                className="availability-matrix-toggle"
                data-testid="availability-matrix-kind-toggle"
                data-value={matrixKind}
                onClick={() => setMatrixKind((p) => (p === "busy-blocks" ? "availability" : "busy-blocks"))}
                aria-label={matrixKind === "busy-blocks"
                  ? "Kind: busy blocks — this calendar's events. Click to switch to availability schedule."
                  : "Kind: availability schedule — this calendar's open-block pattern. Click to switch to busy blocks."}
                title={matrixKind === "busy-blocks"
                  ? "Busy blocks — the calendar's events. Click to switch to Availability schedule (its open-block pattern)."
                  : "Availability schedule — the calendar's open-block pattern. Click to switch to Busy blocks (its events)."}
              >
                {renderMatrixCellIcon()}
                <span className="availability-matrix-toggle-word">
                  {matrixKind === "busy-blocks" ? "busy blocks" : "availability schedule"}
                </span>
              </button>
            )}
            <button
              type="button"
              className="availability-matrix-help-btn"
              data-testid="availability-matrix-help-toggle"
              onClick={() => setShowMatrixHelp((p) => !p)}
              aria-expanded={showMatrixHelp}
              aria-label="What do these do?"
              title="What do these do?"
            >
              ?
            </button>
          </div>
          {showMatrixHelp && (
            <div className="availability-matrix-help-text" data-testid="availability-matrix-help-text">
              <p><strong>Layer</strong> — <em>just looking</em> only changes the grid; <em>tasks queue</em> changes where your tasks are placed.</p>
              <p><strong>Kind</strong> (tasks queue only) — <em>busy blocks</em> is the calendar's events; <em>availability schedule</em> is its open-block pattern.</p>
              <p>Each calendar row shows the one control for the pair you pick here.</p>
            </div>
          )}
        </div>
        <div className="calendar-list-body">
          {calendarsFetchError && (
            <div className="auth-error" data-testid="calendar-list-error">{calendarsFetchError}</div>
          )}
          {calendars.map((cal) => {
            const isMember = formCalendarIds.includes(cal.id);
            const isWritable = canWriteCalendar(cal);
            return (
              <div key={cal.id} className="calendar-row" data-testid={`calendar-row-${cal.id}`}>
                <div className="calendar-row-main">
                  {renderCalendarMatrixControl(cal)}
                  {panelMode === "rigid-config" && (
                    <input
                      type="checkbox"
                      className="calendar-row-membership-check"
                      checked={isMember}
                      disabled={!isWritable || (isMember && formCalendarIds.length <= 1)}
                      onChange={() => toggleFormCalendarMembership(cal.id)}
                      aria-label={`Assign this event to ${cal.name}`}
                      data-testid={`calendar-membership-${cal.id}`}
                    />
                  )}
                  <div className="calendar-row-badge">
                    <span
                      className="calendar-row-swatch"
                      style={{ backgroundColor: getEffectiveCalendarColor(cal) }}
                      aria-hidden="true"
                    />
                  </div>
                  {/* Availability Matrix Phase 4 -- read-only, no more
                      click-to-edit. Rename, recolor, sharing, availability
                      editing, and delete all moved behind the gear below,
                      which every viewer (not just an owner) can now open --
                      see renderCalendarConfigPanel for what each role sees. */}
                  <span className="calendar-row-name" data-testid={`calendar-row-name-${cal.id}`}>
                    {cal.name}
                  </span>
                  <button
                    type="button"
                    className="calendar-row-settings-btn"
                    onClick={() => { setConfigCalendarId(cal.id); setPanelMode("calendar-config"); }}
                    aria-label={`${cal.name} settings`}
                    title="Calendar settings"
                    data-testid={`calendar-settings-${cal.id}`}
                  >
                    <Settings size={14} />
                  </button>
                </div>
                {waveGuardMessage?.calendarId === cal.id && (
                  <div
                    className="calendar-config-field-error calendar-row-wave-guard"
                    data-testid={`calendar-row-wave-guard-${cal.id}`}
                  >
                    <AlertTriangle size={12} /> {waveGuardMessage.text}
                  </div>
                )}
              </div>
            );
          })}
          {isAddCalendarChoiceOpen ? (
            <div className="calendar-add-choice" data-testid="calendar-add-choice">
              <button
                type="button"
                className="calendar-add-choice-btn"
                onClick={() => { setIsAddCalendarChoiceOpen(false); setPanelMode("calendar-create"); setAddCalendarError(null); }}
                data-testid="add-calendar-create-btn"
              >
                <Plus size={14} /> Create
              </button>
              <button
                type="button"
                className="calendar-add-choice-btn"
                onClick={() => { setIsAddCalendarChoiceOpen(false); setIsImportListOpen(true); }}
                data-testid="add-calendar-import-btn"
              >
                <ImportIcon size={14} /> Import
              </button>
              <button
                type="button"
                className="calendar-add-choice-cancel-btn"
                onClick={() => setIsAddCalendarChoiceOpen(false)}
                aria-label="Cancel"
                data-testid="cancel-add-calendar-choice-btn"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="calendar-add-btn"
              onClick={() => setIsAddCalendarChoiceOpen(true)}
              data-testid="add-calendar-btn"
            >
              <Plus size={14} /> New calendar
            </button>
          )}
        </div>
        </>
      )}

      <AlertDialog
        open={!!deletingCalendar}
        onOpenChange={(open) => { if (!open) { setDeletingCalendar(null); setDeleteCalendarError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletingCalendar?.is_owner
                ? `Delete "${deletingCalendar?.name}"?`
                : `Stop viewing "${deletingCalendar?.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCalendarError ? deleteCalendarError : deletingCalendar?.is_owner ? (() => {
                // Tasks are never calendar-scoped, so there's no task
                // clause here at all -- deleting a calendar can never
                // touch them.
                const eventCount = deletingCalendar?.event_count ?? 0;
                const sharedCount = deletingCalendar?.shared_event_count ?? 0;
                const sentences = [];
                if (eventCount > 0) {
                  sentences.push(`This will permanently delete ${eventCount} event${eventCount === 1 ? "" : "s"}.`);
                }
                if (sharedCount > 0) {
                  sentences.push(`${sharedCount} event${sharedCount === 1 ? "" : "s"} also on other calendars will be removed from this calendar but kept.`);
                }
                return sentences.length > 0 ? sentences.join(" ") : "This calendar has no events.";
              })() : (
                "You'll lose access to this calendar. Getting it back requires asking the owner to share it with you again -- there's no automatic re-invite."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteCalendarError && (
              <AlertDialogAction
                onClick={async (e) => {
                  e.preventDefault();
                  if (!deletingCalendar) return;
                  const result = deletingCalendar.is_owner
                    ? await deleteCalendar(deletingCalendar.id)
                    : await leaveSharedCalendar(deletingCalendar.id, deletingCalendar.access_id);
                  if (result.ok) {
                    setDeletingCalendar(null);
                  } else {
                    setDeleteCalendarError(result.message);
                  }
                }}
              >
                {deletingCalendar?.is_owner ? "Delete" : "Remove"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task Deadlines Part 1/3 -- cascade warning. Soft-warn, not
          hard-block: OK commits the pending create/edit/reorder via
          cascadeWarning.onConfirm (the candidate call that got us here
          never persisted anything), Cancel aborts via onCancel with
          nothing applied or persisted. */}
      <AlertDialog
        open={!!cascadeWarning}
        onOpenChange={(open) => { if (!open) cascadeWarning?.onCancel(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This will push other tasks past their deadlines</AlertDialogTitle>
            <AlertDialogDescription>
              The following items will be bumped and miss their deadlines: {cascadeWarning?.names?.join(", ")}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => cascadeWarning?.onConfirm()}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isImportListOpen} onOpenChange={setIsImportListOpen}>
        <DialogContent data-testid="import-calendars-dialog">
          <DialogHeader>
            <DialogTitle>Import a calendar</DialogTitle>
            <DialogDescription>
              Calendars shared with you, and calendars imported from other platforms.
            </DialogDescription>
          </DialogHeader>
          <ImportCalendarsList
            entries={sharedCalendars.map((cal) => ({
              id: cal.access_id,
              calendarName: cal.name,
              ownerLabel: cal.owner_email || "Unknown",
              source: "native",
            }))}
          />
        </DialogContent>
      </Dialog>
    </div>
    );
  };

  if (session === undefined) {
    return <div className="auth-screen"><div className="auth-card" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;
  }
if (!session) {
  return <AuthScreen onSession={(s) => setSession(s)} />;
}
if (session === "PASSWORD_RECOVERY") {
  return <AuthScreen mode="reset" onSession={(s) => setSession(s)} />;
}

  return (
    <div className="app-container" data-testid="flexflow-app">
      {/* Left Panel - Config */}
      <aside
        className={`sidebar${isLeftPanelCollapsed ? " sidebar-collapsed" : ""}${isDraggingLeftPanel ? " panel-dragging" : ""}`}
        style={isLeftPanelCollapsed ? undefined : { width: leftPanelWidth, minWidth: leftPanelWidth, maxWidth: leftPanelWidth }}
      >
        {getPanelModeTitle(panelMode) && (
          <div className="panel-mode-title" data-testid="panel-mode-title">
            {getPanelModeTitle(panelMode)}
          </div>
        )}
        <div className="sidebar-scroll-body">
          {renderSidebarContent()}
          {renderCalendarList()}
        </div>
      </aside>

      {/* Left Panel Resize/Collapse Grip */}
      <button
        className={`panel-grip-handle left-panel-grip-handle${isDraggingLeftPanel ? " panel-grip-handle-dragging" : ""}`}
        onMouseDown={(e) => startPanelInteraction(e, "left")}
        onTouchStart={(e) => startPanelInteraction(e, "left")}
        onDoubleClick={() => setIsLeftPanelCollapsed(prev => !prev)}
        data-testid="left-panel-toggle-grip"
        aria-label={isLeftPanelCollapsed ? "Expand left panel" : "Collapse left panel"}
      >
        <span className="grip-line" />
        <span className="grip-line" />
        <span className="grip-line" />
        <span className="grip-line" />
      </button>

      <>
          {/* Center Panel - Flex Queue */}
          <div
            className={`center-panel ${isQueueCollapsed ? "center-panel-collapsed" : ""}${isDraggingQueuePanel ? " panel-dragging" : ""}`}
            style={isQueueCollapsed ? undefined : { width: queueWidth, minWidth: queueWidth, maxWidth: queueWidth }}
          >
            {renderFlexQueue()}
          </div>

          {/* Queue Toggle Grip -- anchored to the flex queue panel's right edge */}
          <button
            className={`panel-grip-handle queue-grip-handle${isDraggingQueuePanel ? " panel-grip-handle-dragging" : ""}`}
            onMouseDown={(e) => startPanelInteraction(e, "queue")}
            onTouchStart={(e) => startPanelInteraction(e, "queue")}
            onDoubleClick={() => setIsQueueCollapsed(prev => !prev)}
            data-testid="queue-toggle-grip"
            aria-label={isQueueCollapsed ? "Expand flex queue" : "Collapse flex queue"}
          >
            <span className="grip-line" />
            <span className="grip-line" />
            <span className="grip-line" />
            <span className="grip-line" />
          </button>

          {/* Right Panel - Calendar */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", minHeight: 0 }} onClick={(e) => { if (e.target === e.currentTarget) { setFlexEvents(prev => prev.filter(i => !i.isTemp)); setPanelMode("idle"); } }}>
            <div className="calendar-topbar">
              <CalendarIcon size={24} />
              <span className="sidebar-title">FlexFlow</span>
              <div style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "auto" }}>{clockDisplay}</div>
            </div>
            <main className="main-content">
            <header className="calendar-header" onClick={() => { setFlexEvents(prev => prev.filter(i => !i.isTemp)); setPanelMode("idle"); }}>
              <h1 className="calendar-title" data-testid="calendar-title">
                {getHeaderTitle()}
              </h1>

              <div className="header-controls">
                <button className="today-btn" onClick={handleToday} data-testid="today-btn">
                  Today
                </button>

                <div className="nav-buttons">
                  <button className="nav-btn" onClick={handlePrevious} data-testid="prev-btn">
                    <ChevronLeft size={20} />
                  </button>
                  <button className="nav-btn" onClick={handleNext} data-testid="next-btn">
                    <ChevronRight size={20} />
                  </button>
                </div>

                <div className="view-toggle" data-testid="view-toggle">
                  <button
                    className={`view-toggle-btn ${view === "month" ? "active" : ""}`}
                    onClick={() => setView("month")}
                    data-testid="view-month-btn"
                  >
                    Month
                  </button>
                  <button
                    className={`view-toggle-btn ${view === "week" ? "active" : ""}`}
                    onClick={() => {
                      if (selectedCell || selectedEventId || selectedFlexId) {
                        setCurrentDate(selectedDate);
                      }
                      setView("week");
                    }}
                    data-testid="view-week-btn"
                  >
                    Week
                  </button>
                  <button
                    className={`view-toggle-btn ${view === "day" ? "active" : ""}`}
                    onClick={() => {
                      if (selectedCell || selectedEventId || selectedFlexId) {
                        setCurrentDate(selectedDate);
                      }
                      setView("day");
                    }}
                    data-testid="view-day-btn"
                  >
                    Day
                  </button>
                </div>
                <ProfileMenu
                  api={API}
                  email={session?.user?.email}
                  hasNewShares={hasNewShares}
                  onOpenSharedCalendars={() => setIsImportListOpen(true)}
                />
              </div>
            </header>

            {view === "month" && renderMonthView()}
            {view === "week" && renderWeekView()}
            {view === "day" && renderDayView()}
          </main>
          </div>
        </>
    </div>
  );
}

export default App;
