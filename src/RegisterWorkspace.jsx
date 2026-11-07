import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  Plus,
  Download,
  Search,
  Undo2,
  Check,
  LockKeyhole,
  Save,
  X,
} from "lucide-react";
import { api, admin } from "./api";
const dateLabel = (date) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
import {
  attendanceLabels,
  countMarks,
  editReducer,
  parseAttendancePaste,
} from "./register-state";
import "./register-workspace.css";

export default function RegisterWorkspace({
  boot,
  user,
  classId,
  setClassId,
  revision,
  notify,
  navigate,
  ui,
  attendanceTarget,
}) {
  const { Modal, Form, Field, Select, Empty } = ui;
  const subjects = attendanceTarget
    ? [attendanceTarget.subject_record]
    : boot.subjects.filter((s) => s.class_id === +classId);
  const rememberedSubject = () => {
    if (attendanceTarget) return String(attendanceTarget.subject_id);
    try {
      const saved = localStorage.getItem(
        `attendance-subject:${user.id}:${classId}`,
      );
      if (subjects.some((s) => String(s.id) === saved)) return saved;
    } catch {}
    return String(subjects[0]?.id || "");
  };
  const [subjectId, setSubjectId] = useState(rememberedSubject);
  const [month, setMonth] = useState(
    (attendanceTarget?.date || boot.today).slice(0, 7),
  );
  const [data, setData] = useState(null),
    [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(
      attendanceTarget?.attendance_id || null,
    ),
    [focusMode, setFocusMode] = useState(true),
    [historyView, setHistoryView] = useState(false);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [activeStudent, setActiveStudent] = useState(null);
  const [saving, setSaving] = useState(false),
    [savedAt, setSavedAt] = useState(""),
    [reason, setReason] = useState("");
  const [dialog, setDialog] = useState(null),
    [adding, setAdding] = useState(false),
    [reload, setReload] = useState(0);
  const [edit, dispatch] = useReducer(editReducer, {
    marks: {},
    baseline: {},
    history: [],
    dirty: false,
  });
  const grid = useRef(null),
    selection = useRef(null),
    dirty = useRef(false),
    busy = useRef(false);
  selection.current = selected;
  dirty.current = edit.dirty;
  busy.current = saving;
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    setSubjectId(rememberedSubject());
    setSelected(attendanceTarget?.attendance_id || null);
    setData(null);
    setActiveStudent(null);
    dispatch({ type: "load", marks: {} });
    setSearch("");
    setFilter("all");
    setSavedAt("");
  }, [classId]);
  useEffect(() => {
    if (!subjectId) {
      setData(null);
      return;
    }
    if (dirty.current) {
      notify(
        "There are unsaved changes. Save or discard them before reloading the register.",
      );
      return;
    }
    let cancelled = false;
    setLoadError("");
    setData(null);
    api(
      attendanceTarget
        ? "/attendance?scheduled_session_id=" + attendanceTarget.id
        : "/attendance?subject_id=" + subjectId,
    )
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const current = d.sessions.find((s) => s.id === selection.current);
        if (!current) setSelected(null);
        dispatch({
          type: "load",
          marks: Object.fromEntries(
            d.marks
              .filter((m) => m.session_id === current?.id)
              .map((m) => [m.student_id, m.status]),
          ),
        });
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, revision, reload]);
  useEffect(() => {
    const beforeUnload = (e) => {
      if (dirty.current || busy.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const beforeNavigation = (e) => {
      if (
        busy.current ||
        (dirty.current &&
          !window.confirm("Discard unsaved attendance changes?"))
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("before-navigation", beforeNavigation);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("before-navigation", beforeNavigation);
    };
  }, []);
  const cls =
    attendanceTarget?.class_record ||
    boot.classes.find((c) => c.id === +classId);
  const subject = subjects.find((s) => s.id === +subjectId);
  const session = data?.sessions.find((s) => s.id === selected);
  const locked = !!session && session.state !== "draft";
  const canWrite =
    admin(user) ||
    (user.role === "teacher" &&
      data?.scheduled?.faculty_id === user.id &&
      data?.scheduled?.state === "scheduled" &&
      !data?.scheduled?.holiday);
  const canEdit = !!session && canWrite && (!locked || admin(user)) && !saving;
  const students = data?.students || [];
  const counts = countMarks(students, edit.marks);
  const eligibleCount = counts.P + counts.A + counts.L + counts.unmarked;
  const hasLegacy = students.some((s) => edit.marks[s.id] === "N");
  const sessions =
    data?.sessions.filter((s) => !month || s.date.startsWith(month)) || [];
  const visibleSessions = historyView ? sessions : session ? [session] : [];
  const filtered = students.filter(
    (s) =>
      (s.name + " " + s.campus_id + " " + s.registration_number)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "unmarked"
          ? !edit.marks[s.id]
          : edit.marks[s.id] === filter)),
  );
  const { marks, statistics } = useMemo(() => {
    const marks = new Map(),
      statistics = new Map();
    const eligible = new Set(
      data?.sessions
        .filter(
          (s) =>
            ["submitted", "imported"].includes(s.state) && s.date <= boot.today,
        )
        .map((s) => s.id),
    );
    for (const m of data?.marks || []) {
      marks.set(`${m.session_id}:${m.student_id}`, m.status);
      if (eligible.has(m.session_id) && ["P", "A", "L"].includes(m.status)) {
        const value = statistics.get(m.student_id) || { attended: 0, total: 0 };
        value.total++;
        if (m.status !== "A") value.attended++;
        statistics.set(m.student_id, value);
      }
    }
    return { marks, statistics };
  }, [data, boot.today]);
  const guard = () =>
    !saving &&
    (!edit.dirty || window.confirm("Discard unsaved attendance changes?"));
  const resetSelection = () => {
    setSelected(null);
    setActiveStudent(null);
    setReason("");
    setSavedAt("");
    setFilter("all");
    dispatch({ type: "load", marks: {} });
  };
  const choose = (id) => {
    if (id === selected || !guard()) return;
    const s = data?.sessions.find((s) => s.id === id);
    setSelected(s?.id || null);
    setActiveStudent(null);
    setReason("");
    setSavedAt("");
    setFilter("all");
    dispatch({
      type: "load",
      marks: Object.fromEntries(
        (data?.marks || [])
          .filter((m) => m.session_id === id)
          .map((m) => [m.student_id, m.status]),
      ),
    });
  };
  useEffect(() => {
    if (!historyView || !selected || !grid.current) return;
    const header = grid.current.querySelector(`[data-session="${selected}"]`);
    if (header) grid.current.scrollLeft = Math.max(0, header.offsetLeft - 310);
  }, [selected, historyView]);
  const change = (id, status) => {
    if (canEdit && edit.marks[id] !== "N") {
      const index = filtered.findIndex((s) => s.id === id);
      const disappears =
        filter !== "all" &&
        (filter === "unmarked" ? !!status : status !== filter);
      const next = disappears
        ? filtered[index + 1] || filtered[index - 1]
        : null;
      setActiveStudent(id);
      dispatch({ type: "edit", changes: { [id]: status } });
      setSavedAt("");
      if (next) requestAnimationFrame(() => focusRow(next.id));
    }
  };
  const focusRow = (id) =>
    grid.current
      ?.querySelector(`[data-entry="${id}"]`)
      ?.focus({ preventScroll: false });
  const keyboard = (e, student, index) => {
    if (
      !canEdit ||
      dialog ||
      e.target.closest("input, textarea, select, [contenteditable=true]")
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      dispatch({ type: "undo" });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (["P", "A", "L", "BACKSPACE", "DELETE"].includes(key)) {
      e.preventDefault();
      change(student.id, ["BACKSPACE", "DELETE"].includes(key) ? "" : key);
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const next = filtered[index + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) focusRow(next.id);
    }
  };
  const paste = (e, index) => {
    if (
      !canEdit ||
      dialog ||
      e.target.closest("input, textarea, select, [contenteditable=true]")
    )
      return;
    e.preventDefault();
    try {
      const values = parseAttendancePaste(
        e.clipboardData.getData("text"),
        filtered.length - index,
      );
      if (
        filtered
          .slice(index, index + values.length)
          .some((s) => edit.marks[s.id] === "N")
      )
        throw new Error(
          "This paste includes a read-only legacy record. Paste only into eligible rows.",
        );
      setDialog({
        type: "paste",
        rows: values.map((status, i) => ({
          student: filtered[index + i],
          status,
        })),
      });
    } catch (error) {
      notify(error.message);
    }
  };
  const save = async (state) => {
    if (!session || busy.current) return;
    busy.current = true;
    setSaving(true);
    const payload = students
      .filter((s) => edit.marks[s.id] !== "N")
      .map((s) => ({
        student_id: s.id,
        status: edit.marks[s.id] || "",
      }));
    try {
      await api("/attendance/sessions/" + session.id, {
        method: "PUT",
        body: { revision: session.revision, state, reason, marks: payload },
      });
      setData((current) => ({
        ...current,
        sessions: current.sessions.map((s) =>
          s.id === session.id ? { ...s, state, revision: s.revision + 1 } : s,
        ),
        marks: [
          ...current.marks.filter(
            (m) =>
              m.session_id !== session.id ||
              m.status === "N" ||
              !students.some((s) => s.id === m.student_id),
          ),
          ...payload
            .filter((m) => m.status)
            .map((m) => ({ ...m, session_id: session.id })),
        ],
      }));
      dispatch({ type: "load", marks: { ...edit.marks } });
      setReason("");
      setDialog(null);
      setSavedAt(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }),
      );
      notify(
        state === "submitted"
          ? "Attendance submitted and locked."
          : state === "cancelled"
            ? "Session cancelled."
            : "Draft saved.",
      );
    } catch (error) {
      notify(error.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const reviewAllowed =
    canEdit &&
    !counts.unmarked &&
    session.date <= boot.today &&
    (!locked || !!reason.trim());
  const currentStudent = students.find((s) => s.id === activeStudent);
  return (
    <>
      <section
        className={`register-workspace ${focusMode ? "immersive" : ""}`}
        aria-label="Attendance workspace"
        aria-busy={saving}
      >
        <header className="workspace-header">
          <div className="workspace-title">
            <button
              className="icon-button"
              disabled={saving}
              onClick={() =>
                navigate(attendanceTarget ? "timetable" : "overview")
              }
              aria-label="Back to overview"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1>Take Attendance</h1>
              <span>
                {cls
                  ? `${cls.course} · ${cls.section} · ${cls.admission_year}`
                  : "Select a class"}
                {subject ? ` · Semester ${subject.semester}` : ""}
              </span>
            </div>
          </div>
          <div className="button-row">
            <span
              className={`save-indicator ${edit.dirty ? "unsaved" : ""}`}
              role="status"
            >
              {saving
                ? "Saving…"
                : edit.dirty
                  ? "Unsaved changes"
                  : savedAt
                    ? `Saved ${savedAt}`
                    : session?.state === "draft"
                      ? "Draft saved"
                      : "No unsaved changes"}
            </span>
            <button
              className="button"
              onClick={() => setFocusMode((v) => !v)}
              aria-pressed={focusMode}
            >
              {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              <span>{focusMode ? "Exit focus" : "Focus mode"}</span>
            </button>
          </div>
        </header>
        <div className="workspace-controls">
          <Select
            label="Class"
            value={classId}
            disabled={saving || !!attendanceTarget}
            onChange={(e) => {
              if (guard()) setClassId(e.target.value);
            }}
          >
            {(attendanceTarget
              ? [attendanceTarget.class_record]
              : boot.classes
            ).map((c) => (
              <option key={c.id} value={c.id}>
                {c.course} · {c.section} · {c.admission_year}
              </option>
            ))}
          </Select>
          <Select
            label="Subject"
            value={subjectId}
            disabled={saving || !!attendanceTarget}
            onChange={(e) => {
              if (guard()) {
                resetSelection();
                setSubjectId(e.target.value);
                try {
                  localStorage.setItem(
                    `attendance-subject:${user.id}:${classId}`,
                    e.target.value,
                  );
                } catch {}
              }
            }}
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Field
            label="Month"
            type="month"
            value={month}
            disabled={saving || !!attendanceTarget}
            onChange={(e) => {
              if (guard()) {
                resetSelection();
                setMonth(e.target.value);
              }
            }}
          />
          <Select
            label="Session to work on"
            value={selected || ""}
            disabled={!data || saving}
            onChange={(e) => choose(Number(e.target.value))}
          >
            <option value="">Select date & period</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {dateLabel(s.date)} · Period {s.period} ·{" "}
                {s.state === "imported" ? "recorded" : s.state}
              </option>
            ))}
          </Select>
          <details className="workspace-options">
            <summary>More options</summary>
            <div>
              <p>
                <b>Teacher:</b> {subject?.teacher || "Unassigned"}
              </p>
              <p>
                <b>Advisor:</b> {cls?.advisor || "Unassigned"}
              </p>
              {user.role !== "student" &&
                subjectId &&
                (admin(user) || subject?.teacher_id === user.id) && (
                  <a
                    className="button"
                    href={
                      "/api/attendance/export?subject_id=" +
                      subjectId +
                      (month ? "&month=" + encodeURIComponent(month) : "")
                    }
                  >
                    <Download size={16} />
                    Export saved Excel
                  </a>
                )}
              {admin(user) && subjectId && !attendanceTarget && (
                <button
                  className="button"
                  disabled={saving}
                  onClick={() => {
                    if (guard()) {
                      resetSelection();
                      setAdding(true);
                    }
                  }}
                >
                  <Plus size={16} />
                  Add session
                </button>
              )}
              <p>
                P = present · A = absent · L = late. Drafts and unmarked cells
                do not count towards percentages.
              </p>
              <details>
                <summary>Keyboard shortcuts</summary>
                <p>
                  Focus a student’s attendance controls: P = Present, A =
                  Absent, L = Late. ↑ / ↓ moves between students. Delete clears
                  a mark; Ctrl / ⌘ + Z undoes. Shortcuts are inactive in text
                  fields and dialogs.
                </p>
              </details>
              {admin(user) && session && (
                <button
                  className="button danger"
                  disabled={saving}
                  onClick={() => setDialog({ type: "cancel" })}
                >
                  Cancel this session
                </button>
              )}
            </div>
          </details>
        </div>
        <div className="workspace-context">
          <div>
            <strong>
              {session
                ? `${dateLabel(session.date)} · Period ${session.period}`
                : "Choose a session to begin"}
            </strong>
            {session && (
              <span className="session-state">
                {locked ? (
                  <>
                    <LockKeyhole size={12} />{" "}
                    {session.state === "imported" ? "Recorded" : session.state}
                  </>
                ) : counts.unmarked ? (
                  "Draft · editable"
                ) : (
                  "Draft · ready for review"
                )}
              </span>
            )}
            <span className="workspace-subject">
              {subject?.name}
              {attendanceTarget
                ? ` · ${attendanceTarget.faculty} · ${attendanceTarget.start}–${attendanceTarget.end}`
                : ""}
            </span>
          </div>
          {session && (
            <div className="mark-counts" aria-label="Session counts">
              <span className="count-present">
                Present <b>{counts.P}</b>
              </span>
              <span className="count-absent">
                Absent <b>{counts.A}</b>
              </span>
              <span>
                Late <b>{counts.L}</b>
              </span>
              <span>
                {eligibleCount - counts.unmarked} of {eligibleCount} eligible
                marked
              </span>
              <span className={counts.unmarked ? "count-unmarked" : ""}>
                Unmarked <b>{counts.unmarked}</b>
              </span>
            </div>
          )}
        </div>
        <div className="workspace-search">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Find student in register"
              placeholder="Search name, campus ID or reg. no."
              value={search}
              disabled={saving}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                aria-label="Clear search"
                disabled={saving}
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            aria-label="Filter attendance rows"
            disabled={saving || !session}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All students</option>
            <option value="unmarked">Unmarked only</option>
            <option value="P">Present only</option>
            <option value="A">Absent only</option>
            <option value="L">Late only</option>
          </select>
          <span className="visible-count">
            {filtered.length} / {students.length} students
          </span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={historyView}
              onChange={(e) => setHistoryView(e.target.checked)}
            />
            Show other sessions
          </label>
          {canEdit && (
            <>
              <button
                className="button"
                disabled={!counts.unmarked}
                onClick={() => setDialog({ type: "fill" })}
              >
                Mark all present
              </button>
              <button
                className="button"
                disabled={!edit.history.length}
                onClick={() => dispatch({ type: "undo" })}
              >
                <Undo2 size={15} />
                Undo
              </button>
            </>
          )}
        </div>
        <div
          className="workspace-grid"
          ref={grid}
          tabIndex={0}
          aria-label="Scrollable attendance grid"
        >
          {hasLegacy && (
            <p className="legacy-note">
              Legacy N means Not enrolled. These historical records are
              read-only and excluded from marking totals and percentages.
            </p>
          )}
          {loadError ? (
            <div className="empty">
              <p role="alert">{loadError}</p>
              <button
                className="button"
                onClick={() => setReload((n) => n + 1)}
              >
                Retry loading
              </button>
            </div>
          ) : !subjectId ? (
            <Empty
              title="No subjects assigned"
              text="Your assigned subjects will appear here."
            />
          ) : !data ? (
            <div className="loading-inline">Loading register…</div>
          ) : !session && !historyView ? (
            <Empty
              title={
                sessions.length
                  ? "Select a date and period"
                  : "No sessions this month"
              }
              text={
                sessions.length
                  ? "Work on one session at a time. Other sessions stay protected."
                  : "Choose another month or use More options to add a session."
              }
            />
          ) : (
            <table
              className={`workspace-table ${historyView ? "history-view" : "entry-view"}`}
            >
              <thead>
                <tr>
                  <th className="pinned-student">
                    Student <small>Campus ID / registration no.</small>
                  </th>
                  {visibleSessions.map((s) => (
                    <th
                      key={s.id}
                      data-session={s.id}
                      className={s.id === selected ? "editing-column" : ""}
                    >
                      <button
                        disabled={saving}
                        onClick={() => choose(s.id)}
                        aria-label={`Select ${s.date} period ${s.period}`}
                      >
                        <b>
                          {dateLabel(s.date)} · P{s.period}
                        </b>
                        <small>
                          {historyView
                            ? s.id === selected
                              ? "ACTIVE SESSION"
                              : s.state
                            : "Present · Absent · Late"}
                        </small>
                      </button>
                    </th>
                  ))}
                  {historyView && (
                    <th>
                      Recorded attendance
                      <small>All recorded sessions for this subject</small>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, index) => {
                  const stats = statistics.get(s.id) || {
                    attended: 0,
                    total: 0,
                  };
                  return (
                    <tr
                      key={s.id}
                      className={s.id === activeStudent ? "active-student" : ""}
                    >
                      <th scope="row" className="pinned-student">
                        <div className="register-student">
                          <span>{students.indexOf(s) + 1}</span>
                          <div>
                            <b>{s.name}</b>
                            <small>
                              {s.campus_id}
                              {s.registration_number
                                ? " · " + s.registration_number
                                : ""}
                            </small>
                          </div>
                        </div>
                      </th>
                      {visibleSessions.map((t) => {
                        const active = t.id === selected,
                          v = active
                            ? edit.marks[s.id] || ""
                            : marks.get(`${t.id}:${s.id}`) || "";
                        return (
                          <td
                            key={t.id}
                            className={active ? "editing-column" : ""}
                          >
                            {active && canEdit && v !== "N" ? (
                              <div
                                className="attendance-entry"
                                data-entry={s.id}
                                tabIndex={0}
                                role="group"
                                aria-label={`${s.name}, ${session.date}, period ${session.period}, ${attendanceLabels[v] || "unmarked"}`}
                                onFocus={() => setActiveStudent(s.id)}
                                onKeyDown={(e) => keyboard(e, s, index)}
                                onPaste={(e) => paste(e, index)}
                              >
                                {Object.entries(attendanceLabels).map(
                                  ([code, label]) => (
                                    <button
                                      key={code}
                                      className={
                                        "status-choice " +
                                        code +
                                        (v === code ? " chosen" : "")
                                      }
                                      aria-pressed={v === code}
                                      aria-label={`${label}: ${s.name}`}
                                      title={label}
                                      onClick={() => change(s.id, code)}
                                    >
                                      <span aria-hidden="true">
                                        {v === code ? "✓ " : ""}
                                      </span>
                                      {label}
                                    </button>
                                  ),
                                )}
                                <button
                                  className="clear-mark"
                                  aria-label={`Clear attendance for ${s.name}`}
                                  title="Clear mark"
                                  disabled={!v}
                                  onClick={() => change(s.id, "")}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <span
                                className={"mark " + (v || "blank")}
                                aria-label={
                                  v === "N"
                                    ? "Legacy N — Not enrolled (read-only)"
                                    : attendanceLabels[v] || "Unmarked"
                                }
                              >
                                {v === "N"
                                  ? "Legacy N · Not enrolled"
                                  : v || "—"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {historyView && (
                        <td>
                          <span
                            className={
                              "percentage " +
                              (stats.total &&
                              (stats.attended / stats.total) * 100 <
                                boot.threshold
                                ? "low"
                                : "")
                            }
                          >
                            {stats.total
                              ? Math.round(
                                  (stats.attended / stats.total) * 100,
                                ) + "%"
                              : "—"}
                          </span>
                          <small>
                            {stats.attended} / {stats.total}
                          </small>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {data && session && !filtered.length && (
            <Empty
              title="No matching students"
              text="Clear the search or switch to All students."
            />
          )}
        </div>
        <footer className="workspace-footer">
          <div className="workspace-guidance">
            <strong>
              {currentStudent
                ? `${currentStudent.name} · ${currentStudent.campus_id}`
                : session
                  ? canEdit
                    ? "Choose Present, Absent or Late for each student."
                    : "Read-only. Open an assigned class from your timetable to take attendance."
                  : "Your changes are saved only when you choose Save draft or Submit."}
            </strong>
            <small>
              {canEdit
                ? "Click a labelled status, or type P / A / L. ↑ ↓ moves between students. Paste is previewed before applying."
                : locked
                  ? "Submitted attendance requires an administrator and correction reason to change."
                  : "Select a session above. Student names and column headings stay pinned."}
            </small>
          </div>
          {session && canWrite && (!locked || admin(user)) && (
            <div className="workspace-save">
              {locked && (
                <input
                  aria-label="Correction reason"
                  placeholder="Correction reason (required)"
                  value={reason}
                  disabled={saving}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
              <button
                className="button"
                disabled={
                  saving ||
                  (!edit.dirty && !locked) ||
                  (locked && !reason.trim())
                }
                onClick={() => save("draft")}
              >
                <Save size={16} />
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button
                className="button primary"
                disabled={!reviewAllowed}
                title={
                  counts.unmarked
                    ? "Mark every student before submitting"
                    : session.date > boot.today
                      ? "Future sessions cannot be submitted"
                      : locked && !reason.trim()
                        ? "Add a correction reason"
                        : "Review before submitting"
                }
                onClick={() => setDialog({ type: "submit" })}
              >
                <Check size={16} />
                Review & submit
              </button>
            </div>
          )}
        </footer>
      </section>
      {dialog && (
        <Modal
          title={
            {
              submit: "Review attendance before submitting",
              fill: "Fill unmarked students as present",
              paste: "Review pasted attendance",
              cancel: "Cancel teaching session",
            }[dialog.type]
          }
          close={() => {
            if (!saving) setDialog(null);
          }}
        >
          <div className="register-review-context">
            <b>
              {cls?.course} · {cls?.section} · {subject?.name}
            </b>
            <p>
              {session ? dateLabel(session.date) : ""} · Period{" "}
              {session?.period}
            </p>
          </div>
          {hasLegacy && (
            <p className="legacy-note">
              Legacy N records remain read-only and excluded from attendance
              percentages and marking totals.
            </p>
          )}
          {dialog.type === "submit" && (
            <>
              <p>
                {students.length} students · {counts.P} present · {counts.A}{" "}
                absent · {counts.L} late · {counts.unmarked} unmarked.
              </p>
              <p className="muted">
                Review absences and exceptions below. Submission locks this
                session and may queue absence notifications for opted-in
                recipients.
              </p>
              <div className="register-review-list">
                {students
                  .filter((s) => ["A", "L"].includes(edit.marks[s.id]))
                  .map((s) => (
                    <div key={s.id}>
                      <span>
                        {s.name}
                        <small>{s.campus_id}</small>
                      </span>
                      <b>{attendanceLabels[edit.marks[s.id]]}</b>
                    </div>
                  ))}
                {!counts.A && !counts.L && (
                  <p>All eligible students are marked present.</p>
                )}
              </div>
              <button
                className="button primary"
                disabled={saving || !reviewAllowed}
                onClick={() => save("submitted")}
              >
                {saving ? "Submitting…" : "Confirm & submit"}
              </button>
            </>
          )}
          {dialog.type === "fill" && (
            <>
              <p>
                Mark the {counts.unmarked} currently unmarked students in this
                entire class as present, including any hidden by your search or
                filter. Existing marks will be preserved.
              </p>
              <div className="form-footer">
                <button
                  className="button primary"
                  onClick={() => {
                    dispatch({
                      type: "edit",
                      changes: Object.fromEntries(
                        students
                          .filter((s) => !edit.marks[s.id])
                          .map((s) => [s.id, "P"]),
                      ),
                    });
                    setSavedAt("");
                    setDialog(null);
                  }}
                >
                  Fill {counts.unmarked} unmarked students
                </button>
              </div>
            </>
          )}
          {dialog.type === "paste" && (
            <>
              <p>
                {dialog.rows.length} visible student rows will be updated in the
                order shown. Blank pasted cells clear existing marks.
              </p>
              <div className="register-review-list">
                {dialog.rows.map(({ student, status }) => (
                  <div key={student.id}>
                    <span>
                      {student.name}
                      <small>{student.campus_id}</small>
                    </span>
                    <span>
                      {edit.marks[student.id] || "—"} →{" "}
                      <b>{status || "Clear"}</b>
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="button primary"
                onClick={() => {
                  dispatch({
                    type: "edit",
                    changes: Object.fromEntries(
                      dialog.rows.map((r) => [r.student.id, r.status]),
                    ),
                  });
                  setSavedAt("");
                  setDialog(null);
                }}
              >
                Apply {dialog.rows.length} rows
              </button>
            </>
          )}
          {dialog.type === "cancel" && (
            <>
              <p>
                This session will be excluded from attendance percentages.
                Existing marks remain in the audit history.
              </p>
              {(locked || session?.scheduled_session_id) && (
                <Field
                  label="Correction reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
              <div className="form-footer">
                <button
                  className="button danger"
                  disabled={
                    saving ||
                    ((locked || session?.scheduled_session_id) &&
                      !reason.trim())
                  }
                  onClick={() => save("cancelled")}
                >
                  Confirm cancellation
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {adding && (
        <Modal title="Add teaching session" close={() => setAdding(false)}>
          <Form
            onSubmit={async (b) => {
              const result = await api("/attendance/sessions", {
                method: "POST",
                body: { ...b, subject_id: +subjectId },
              });
              setAdding(false);
              setMonth(b.date.slice(0, 7));
              setSelected(result.id);
              selection.current = result.id;
              setReload((n) => n + 1);
              notify(
                "Session added. Confirm the date and period before marking attendance.",
              );
            }}
          >
            <Field
              label="Date"
              name="date"
              type="date"
              defaultValue={boot.today}
              required
            />
            <Field
              label="Period"
              name="period"
              type="number"
              min="1"
              max="20"
              defaultValue="1"
              required
            />
          </Form>
        </Modal>
      )}
    </>
  );
}
