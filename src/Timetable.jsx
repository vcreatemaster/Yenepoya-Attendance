import React, { useEffect, useState } from "react";
import { api, admin } from "./api";
import "./timetable.css";
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const campusDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const addDays = (date, n) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (date) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
function useSchedule(from, to, revision = 0, classId = "") {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api(
      `/schedule?from=${from}&to=${to}${classId ? "&class_id=" + classId : ""}`,
    )
      .then((d) => {
        if (active) setData(d.sessions);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [from, to, revision, classId, tick]);
  return { data, error, retry: () => setTick((x) => x + 1) };
}
export function sessionStatus(s) {
  if (s.state === "cancelled") return "Cancelled";
  if (["submitted", "imported"].includes(s.attendance_state))
    return "Completed · attendance recorded";
  if (s.holiday) return "Cancelled";
  const now = Date.now(),
    start = Date.parse(`${s.date}T${s.start}:00+05:30`),
    end = Date.parse(`${s.date}T${s.end}:00+05:30`);
  if (now < start) return "Upcoming";
  if (now < end) return "In progress · scheduled";
  return "Time elapsed · attendance pending";
}
function SessionCard({ s, user, onAttendance, onEdit, highlight }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article
      className={`schedule-session ${highlight ? "next-session" : ""} ${s.state === "cancelled" || s.holiday ? "cancelled-session" : ""}`}
    >
      <div className="schedule-time">
        {s.start}–{s.end}
        <small>Period {s.period}</small>
      </div>
      <div className="schedule-description">
        <b>{s.subject}</b>
        <span>
          {s.course} · Section {s.section} · {s.faculty}
        </span>
        {s.room && <span>Location: {s.room}</span>}
        <small>
          {sessionStatus(s)}
          {s.holiday ? ` · ${s.holiday}` : ""}
        </small>
        {s.revised && (
          <span className="revision-label">
            Updated · {s.change_type.replaceAll("_", " ")}
            {s.origin_date !== s.date ? ` from ${dayLabel(s.origin_date)}` : ""}
          </span>
        )}
        {s.reason && <small>{s.reason}</small>}
      </div>
      <div className="schedule-actions">
        {(user.role === "teacher" || admin(user)) && onAttendance && (
          <button
            className="button primary"
            disabled={busy || s.state === "cancelled" || !!s.holiday}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onAttendance(s);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Opening…"
              : s.attendance_id
                ? "Open attendance"
                : "Take attendance"}
          </button>
        )}
        {onEdit && (
          <button className="button" onClick={() => onEdit(s)}>
            Change this session only
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function TodayClasses({ user, revision, navigate, openScheduled }) {
  const date = campusDate();
  const { data, error, retry } = useSchedule(date, date, revision);
  if (!["teacher", "student", "master_admin", "admin"].includes(user.role))
    return null;
  const next = data?.find(
    (s) =>
      s.state === "scheduled" &&
      !s.holiday &&
      Date.parse(`${s.date}T${s.end}:00+05:30`) > Date.now(),
  );
  return (
    <section className="schedule-panel">
      <div className="schedule-heading">
        <div>
          <h2>Today's Classes</h2>
          <small>{dayLabel(date)} · India Standard Time</small>
        </div>
        <button className="button" onClick={() => navigate("timetable")}>
          View full timetable
        </button>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className="button" onClick={retry}>
            Retry
          </button>
        </p>
      ) : !data ? (
        <p>Loading scheduled classes…</p>
      ) : !data.length ? (
        <p className="schedule-empty">No classes scheduled for today.</p>
      ) : (
        data.map((s) => (
          <SessionCard
            key={s.id}
            s={s}
            user={user}
            onAttendance={openScheduled}
            highlight={s.id === next?.id}
          />
        ))
      )}
    </section>
  );
}
export function WeeklySchedule({
  user,
  boot,
  revision,
  openScheduled,
  ui,
  classFilter = "",
}) {
  const { Modal, Field, Select } = ui;
  const [date, setDate] = useState(campusDate()),
    [reload, setReload] = useState(0),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const monday = addDays(
      date,
      -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7),
    ),
    week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const {
    data,
    error: loadError,
    retry,
  } = useSchedule(monday, week[6], revision + reload, classFilter);
  const [values, setValues] = useState({});
  const edit = (s) => {
    setError("");
    setEditing(s || {});
    setValues(
      s
        ? { ...s, holiday_override: !!s.holiday_override }
        : {
            class_id: Number(classFilter || boot.classes[0]?.id),
            subject_id: "",
            faculty_id: "",
            date,
            period: 1,
            start: "09:00",
            end: "10:00",
            room: "",
            state: "scheduled",
            holiday_override: false,
            reason: "",
          },
    );
  };
  const change = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const cls = boot.classes.find((c) => c.id === Number(values.class_id));
  const subjects = boot.subjects.filter(
    (s) =>
      s.class_id === Number(values.class_id) &&
      s.semester === (editing?.semester || cls?.semester),
  );
  return (
    <section className="schedule-panel">
      <div className="schedule-heading">
        <div>
          <h2>Published weekly schedule</h2>
          <small>India Standard Time · updates refresh every minute</small>
        </div>
        <div className="button-row">
          <Field
            label="Week containing"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          {admin(user) && (
            <button className="button primary" onClick={() => edit(null)}>
              Add extra class
            </button>
          )}
        </div>
      </div>
      {loadError ? (
        <p role="alert">
          {loadError} <button onClick={retry}>Retry</button>
        </p>
      ) : !data ? (
        <p>Loading timetable…</p>
      ) : (
        <div className="published-week">
          {week.map((d) => (
            <section key={d} className="schedule-day">
              <h3>{dayLabel(d)}</h3>
              {data
                .filter((s) => s.date === d)
                .map((s) => (
                  <SessionCard
                    key={s.id}
                    s={s}
                    user={user}
                    onAttendance={openScheduled}
                    onEdit={admin(user) ? edit : null}
                  />
                ))}
              {!data.some((s) => s.date === d) && (
                <p className="schedule-empty">No classes scheduled.</p>
              )}
            </section>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          title={editing.id ? "Change this session only" : "Add an extra class"}
          close={() => !busy && setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/schedule" + (editing.id ? "/" + editing.id : ""), {
                  method: editing.id ? "PUT" : "POST",
                  body: {
                    ...values,
                    class_id: +values.class_id,
                    subject_id: +values.subject_id,
                    faculty_id: +values.faculty_id,
                    period: +values.period,
                  },
                });
                setEditing(null);
                setReload((x) => x + 1);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="muted">
              This changes one dated occurrence. To change the weekly pattern,
              create a recurring timetable revision. Existing attendance is
              protected.
            </p>
            <Select
              label="Class"
              value={values.class_id}
              disabled={!!editing.id}
              onChange={(e) => {
                change("class_id", +e.target.value);
                change("subject_id", "");
              }}
            >
              {boot.classes.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.course} · {c.admission_year} · {c.section}
                </option>
              ))}
            </Select>
            <Select
              label="Subject"
              required
              value={values.subject_id}
              onChange={(e) => {
                change("subject_id", +e.target.value);
                change(
                  "faculty_id",
                  subjects.find((s) => s.id === +e.target.value)?.teacher_id ||
                    "",
                );
              }}
            >
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select
              label="Faculty / authorized substitute"
              required
              value={values.faculty_id}
              onChange={(e) => change("faculty_id", +e.target.value)}
            >
              <option value="">Select faculty</option>
              {boot.staff
                .filter((s) => s.role === "teacher" && s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
            <div className="timetable-fields">
              <Field
                label="Date"
                type="date"
                required
                value={values.date}
                onChange={(e) => change("date", e.target.value)}
              />
              <Field
                label="Period"
                type="number"
                min="1"
                max="20"
                required
                value={values.period}
                onChange={(e) => change("period", +e.target.value)}
              />
              <Field
                label="Start time"
                type="time"
                required
                value={values.start}
                onChange={(e) => change("start", e.target.value)}
              />
              <Field
                label="End time"
                type="time"
                required
                value={values.end}
                onChange={(e) => change("end", e.target.value)}
              />
            </div>
            <Field
              label="Room / location"
              value={values.room}
              onChange={(e) => change("room", e.target.value)}
            />
            {editing.id && (
              <Select
                label="Session status"
                value={values.state}
                onChange={(e) => change("state", e.target.value)}
              >
                <option value="scheduled">Scheduled</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={values.holiday_override}
                onChange={(e) => change("holiday_override", e.target.checked)}
              />
              Authorize special working session / holiday override
            </label>
            <Field
              label="Reason (required for audit history)"
              required
              minLength="3"
              value={values.reason}
              onChange={(e) => change("reason", e.target.value)}
            />
            {error && (
              <p role="alert" className="timetable-error">
                {error}
              </p>
            )}
            <div className="form-footer">
              <button
                type="button"
                className="button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save occurrence"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
function PeriodEditor({ config, setConfig }) {
  const [day, setDay] = useState(config.days[0] ?? 1);
  return (
    <div className="period-editor">
      <p>
        Select working days and define teaching periods or breaks. Timings can
        differ by day.
      </p>
      <div className="button-row">
        {days.map((d, i) => (
          <label className="checkbox" key={d}>
            <input
              type="checkbox"
              checked={config.days.includes(i)}
              onChange={(e) =>
                setConfig({
                  ...config,
                  days: e.target.checked
                    ? [...config.days, i].sort()
                    : config.days.filter((x) => x !== i),
                  slots: e.target.checked
                    ? config.slots
                    : config.slots.filter((s) => s.day !== i),
                })
              }
            />
            {d.slice(0, 3)}
          </label>
        ))}
      </div>
      <label className="field">
        <span>Configure day</span>
        <select value={day} onChange={(e) => setDay(+e.target.value)}>
          {days.map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {config.slots.map(
        (s, i) =>
          s.day === day && (
            <div className="period-row" key={i}>
              <label>
                Period
                <input
                  aria-label="Period number"
                  type="number"
                  min="1"
                  max="20"
                  value={s.period}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      slots: config.slots.map((v, n) =>
                        n === i ? { ...v, period: +e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Type
                <select
                  aria-label="Period type"
                  value={s.kind}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      slots: config.slots.map((v, n) =>
                        n === i ? { ...v, kind: e.target.value } : v,
                      ),
                    })
                  }
                >
                  <option value="class">Teaching</option>
                  <option value="break">Break</option>
                </select>
              </label>
              {["start", "end"].map((k) => (
                <label key={k}>
                  {k}
                  <input
                    aria-label={`${k} time`}
                    type="time"
                    value={s[k]}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        slots: config.slots.map((v, n) =>
                          n === i ? { ...v, [k]: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                className="button"
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    slots: config.slots.filter((_, n) => n !== i),
                  })
                }
              >
                Remove
              </button>
            </div>
          ),
      )}
      <button
        type="button"
        className="button"
        disabled={!config.days.includes(day)}
        onClick={() =>
          setConfig({
            ...config,
            slots: [
              ...config.slots,
              {
                day,
                period:
                  Math.max(
                    0,
                    ...config.slots
                      .filter((s) => s.day === day)
                      .map((s) => s.period),
                  ) + 1,
                start: "09:00",
                end: "10:00",
                kind: "class",
                label: "",
              },
            ],
          })
        }
      >
        Add period / break
      </button>
    </div>
  );
}
export default function Timetable({
  boot,
  user,
  revision,
  notify,
  openScheduled,
  ui,
}) {
  if (!admin(user))
    return <WeeklySchedule {...{ boot, user, revision, openScheduled, ui }} />;
  return (
    <TimetableAdmin {...{ boot, user, revision, notify, openScheduled, ui }} />
  );
}
function TimetableAdmin({ boot, user, revision, notify, openScheduled, ui }) {
  const { Modal, Field, Select } = ui;
  const [course, setCourse] = useState(""),
    [batch, setBatch] = useState(""),
    [search, setSearch] = useState(""),
    [classId, setClassId] = useState(String(boot.classes[0]?.id || "")),
    [semester, setSemester] = useState(boot.classes[0]?.semester || 1);
  const [versions, setVersions] = useState([]),
    [v, setV] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [values, setValues] = useState({}),
    [preview, setPreview] = useState(null);
  const guard = () =>
    !busy && (!dirty || window.confirm("Discard unsaved timetable changes?"));
  useEffect(() => {
    const handler = (e) => {
      if (
        busy ||
        (dirty && !window.confirm("Discard unsaved timetable changes?"))
      )
        e.preventDefault();
    };
    const unload = (e) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("before-navigation", handler);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("before-navigation", handler);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, busy]);
  useEffect(() => {
    let active = true;
    setError("");
    setV(null);
    setVersions([]);
    if (classId)
      api("/timetables?class_id=" + classId)
        .then((d) => {
          if (active) setVersions(d);
        })
        .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [classId]);
  const load = async (value) => {
    if (!guard()) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("/timetables/" + value);
      setV(data);
      setSemester(data.semester);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (patch) => {
    setV((x) => ({ ...x, ...patch }));
    setDirty(true);
    setPreview(null);
  };
  const save = async () => {
    const saved = await api("/timetables/" + v.id, {
      method: "PUT",
      body: {
        revision: v.revision,
        effective_from: v.effective_from,
        effective_to: v.effective_to,
        config: v.config,
        entries: v.entries,
      },
    });
    setV(saved);
    setDirty(false);
    return saved;
  };
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const filteredClasses = boot.classes.filter(
    (c) =>
      (!course || String(c.course_id) === course) &&
      (!batch || String(c.admission_year) === batch) &&
      `${c.course} ${c.section} ${c.admission_year}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const cls = boot.classes.find((c) => String(c.id) === classId),
    subjects = boot.subjects.filter(
      (s) =>
        s.class_id === +classId &&
        s.semester === Number(v?.semester || semester),
    );
  const newDraft = (revise = false) => {
    if (!guard()) return;
    setValues({
      effective_from: campusDate(),
      effective_to: addDays(campusDate(), 90),
      semester: v?.semester || semester,
      ...(revise ? { source_id: v.id } : {}),
    });
    setModal("new");
  };
  return (
    <div className="timetable-admin">
      <div className="timetable-filters">
        <Select
          label="Course"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
        >
          <option value="">All courses</option>
          {boot.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </Select>
        <Select
          label="Batch / admission year"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
        >
          <option value="">All batches</option>
          {[...new Set(boot.classes.map((c) => c.admission_year))].map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
        <Field
          label="Find class"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Course, section or year"
        />
        <Select
          label="Class / section"
          value={classId}
          onChange={(e) => {
            if (guard()) {
              setClassId(e.target.value);
              setSemester(
                boot.classes.find((c) => c.id === +e.target.value)?.semester ||
                  1,
              );
              setDirty(false);
            }
          }}
        >
          {!filteredClasses.some((c) => String(c.id) === classId) && cls && (
            <option value={cls.id}>
              {cls.course} · {cls.admission_year} · {cls.section} (selected)
            </option>
          )}
          {filteredClasses.map((c) => (
            <option value={c.id} key={c.id}>
              {c.course} · {c.admission_year} · {c.section}
            </option>
          ))}
        </Select>
        <Field
          label="Semester"
          type="number"
          min="1"
          max="20"
          value={semester}
          disabled={!!v}
          onChange={(e) => setSemester(+e.target.value)}
        />
      </div>
      <div className="schedule-heading">
        <div>
          <h2>
            {cls?.course} · Section {cls?.section}
          </h2>
          <small>
            {v
              ? `${v.state === "published" ? "Published · read-only" : "Draft"} · ${dirty ? "Unsaved changes" : "Saved"} · ${v.effective_from} to ${v.effective_to}`
              : "Select a saved version or create a draft."}
          </small>
        </div>
        <div className="button-row">
          <Select
            label="Version history"
            value={v?.id || ""}
            disabled={busy}
            onChange={(e) => e.target.value && load(e.target.value)}
          >
            <option value="">Select version</option>
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.state} · Semester {x.semester} · {x.effective_from} –{" "}
                {x.effective_to}
                {x.published_at
                  ? " · published " +
                    new Date(
                      x.published_at.replace(" ", "T") + "Z",
                    ).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                  : ""}
              </option>
            ))}
          </Select>
          <button
            className="button"
            disabled={busy || !classId}
            onClick={() => newDraft()}
          >
            New draft
          </button>
          {v?.state === "published" && (
            <button
              className="button"
              disabled={busy}
              onClick={() => newDraft(true)}
            >
              Revise recurring timetable
            </button>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setValues(await api("/timetable/config"));
                setModal("institution");
              })
            }
          >
            Working days & periods
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="timetable-error">
          {error}
        </p>
      )}
      {v && (
        <>
          <div className="timetable-toolbar">
            <span>
              {v.entries.length} weekly classes · semester {v.semester}
            </span>
            {v.state === "draft" && (
              <>
                <Field
                  label="Effective from"
                  type="date"
                  value={v.effective_from}
                  onChange={(e) => update({ effective_from: e.target.value })}
                />
                <Field
                  label="Effective through"
                  type="date"
                  value={v.effective_to}
                  onChange={(e) => update({ effective_to: e.target.value })}
                />
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setValues(structuredClone(v.config));
                    setModal("periods");
                  }}
                >
                  Edit this version’s periods
                </button>
                <button
                  className="button"
                  disabled={busy || !dirty}
                  onClick={() =>
                    run(async () => {
                      await save();
                      notify("Timetable draft saved.");
                    })
                  }
                >
                  Save draft
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (dirty) await save();
                      const p = await api(`/timetables/${v.id}/preview`, {
                        method: "POST",
                      });
                      setPreview(p);
                      setModal("preview");
                    })
                  }
                >
                  Preview timetable & publish
                </button>
              </>
            )}
          </div>
          <div className="timetable-grid-wrap">
            <table className="timetable-grid">
              <thead>
                <tr>
                  <th>Period / time</th>
                  {v.config.days.map((d) => (
                    <th key={d}>{days[d]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set(v.config.slots.map((s) => s.period))]
                  .sort((a, b) => a - b)
                  .map((period) => (
                    <tr key={period}>
                      <th>
                        Period {period}
                        <small>Day-specific timings</small>
                      </th>
                      {v.config.days.map((day) => {
                        const slot = v.config.slots.find(
                            (s) => s.day === day && s.period === period,
                          ),
                          e = v.entries.find(
                            (e) => e.day === day && e.period === period,
                          );
                        return (
                          <td key={day}>
                            {!slot ? (
                              <span>—</span>
                            ) : slot.kind === "break" ? (
                              <div className="timetable-break">
                                Break
                                <small>
                                  {slot.start}–{slot.end}
                                </small>
                              </div>
                            ) : (
                              <button
                                className="timetable-cell"
                                disabled={v.state !== "draft" || busy}
                                onClick={() => {
                                  setValues(
                                    e
                                      ? { ...e }
                                      : {
                                          day,
                                          period,
                                          start: slot.start,
                                          end: slot.end,
                                          subject_id: "",
                                          faculty_id: "",
                                          room: "",
                                        },
                                  );
                                  setModal("entry");
                                }}
                              >
                                <small>
                                  {e?.start || slot.start}–{e?.end || slot.end}
                                </small>
                                <b>
                                  {e
                                    ? boot.subjects.find(
                                        (s) => s.id === e.subject_id,
                                      )?.name || "Subject unavailable"
                                    : v.state === "draft"
                                      ? "+ Assign subject"
                                      : "No session"}
                                </b>
                                {e && (
                                  <>
                                    <span>
                                      {
                                        boot.staff.find(
                                          (s) => s.id === e.faculty_id,
                                        )?.name
                                      }
                                    </span>
                                    <small>{e.room}</small>
                                  </>
                                )}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <WeeklySchedule
        {...{
          user,
          boot,
          revision: revision + (v?.revision || 0) + versions.length,
          openScheduled,
          ui,
        }}
        classFilter={classId}
      />
      {modal && (
        <Modal
          title={
            {
              new: values.source_id
                ? "Revise recurring timetable from a date"
                : "Create timetable draft",
              entry: `${days[values.day]} · Period ${values.period}`,
              periods: "Period schedule for this version",
              institution: "Institution working days and period defaults",
              preview: "Review timetable publication",
            }[modal]
          }
          close={() => !busy && setModal(null)}
        >
          {error && (
            <p role="alert" className="timetable-error">
              {error}
            </p>
          )}
          {modal === "new" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const result = await api("/timetables", {
                    method: "POST",
                    body: {
                      ...values,
                      class_id: +classId,
                      semester: +values.semester,
                    },
                  });
                  const list = await api("/timetables?class_id=" + classId);
                  setVersions(list);
                  setV(await api("/timetables/" + result.id));
                  setSemester(+values.semester);
                  setDirty(false);
                  setModal(null);
                });
              }}
            >
              <p>
                {cls?.course} · {cls?.admission_year} · Section {cls?.section}.
                Drafts are private to administrators.
              </p>
              <Field
                label="Semester"
                type="number"
                min="1"
                max="20"
                required
                disabled={!!values.source_id}
                value={values.semester}
                onChange={(e) =>
                  setValues({ ...values, semester: +e.target.value })
                }
              />
              {["effective_from", "effective_to"].map((k) => (
                <Field
                  key={k}
                  label={
                    k === "effective_from"
                      ? "Effective from"
                      : "Effective through"
                  }
                  type="date"
                  required
                  value={values[k]}
                  onChange={(e) =>
                    setValues({ ...values, [k]: e.target.value })
                  }
                />
              ))}
              <button className="button primary" disabled={busy}>
                Create draft
              </button>
            </form>
          )}
          {modal === "entry" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (values.start >= values.end) {
                  setError("End time must be after start time.");
                  return;
                }
                if (
                  v.entries.some(
                    (x) =>
                      x.day === values.day &&
                      x.period !== values.period &&
                      values.start < x.end &&
                      x.start < values.end,
                  )
                ) {
                  setError("This class has an overlapping session.");
                  return;
                }
                update({
                  entries: [
                    ...v.entries.filter(
                      (x) => x.day !== values.day || x.period !== values.period,
                    ),
                    {
                      ...values,
                      subject_id: +values.subject_id,
                      faculty_id: +values.faculty_id,
                    },
                  ],
                });
                setError("");
                setModal(null);
              }}
            >
              <Select
                label="Subject"
                required
                value={values.subject_id}
                onChange={(e) =>
                  setValues({
                    ...values,
                    subject_id: +e.target.value,
                    faculty_id:
                      subjects.find((s) => s.id === +e.target.value)
                        ?.teacher_id || "",
                  })
                }
              >
                <option value="">Select subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select
                label="Assigned faculty"
                required
                value={values.faculty_id}
                onChange={(e) =>
                  setValues({ ...values, faculty_id: +e.target.value })
                }
              >
                <option value="">Select assigned faculty</option>
                {boot.staff
                  .filter(
                    (u) =>
                      u.id ===
                        subjects.find((s) => s.id === +values.subject_id)
                          ?.teacher_id &&
                      u.active &&
                      u.role === "teacher",
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
              <p className="muted">
                Faculty eligibility follows Academic setup. Use a dated
                exception for a substitute.
              </p>
              <div className="timetable-fields">
                {["start", "end"].map((k) => (
                  <Field
                    key={k}
                    label={k === "start" ? "Start time" : "End time"}
                    type="time"
                    required
                    value={values[k]}
                    onChange={(e) =>
                      setValues({ ...values, [k]: e.target.value })
                    }
                  />
                ))}
              </div>
              <Field
                label="Room / location (optional)"
                value={values.room}
                onChange={(e) => setValues({ ...values, room: e.target.value })}
              />
              <div className="form-footer">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                {v.entries.some(
                  (x) => x.day === values.day && x.period === values.period,
                ) && (
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this weekly session from the draft?",
                        )
                      ) {
                        update({
                          entries: v.entries.filter(
                            (x) =>
                              x.day !== values.day ||
                              x.period !== values.period,
                          ),
                        });
                        setModal(null);
                      }
                    }}
                  >
                    Remove session
                  </button>
                )}
                <button className="button primary">Save to draft</button>
              </div>
            </form>
          )}
          {(modal === "periods" || modal === "institution") && (
            <>
              <PeriodEditor config={values} setConfig={setValues} />
              <p className="muted">
                {modal === "institution"
                  ? "Defaults apply to new drafts only. Existing versions remain unchanged."
                  : "Changing periods may require reassigning affected draft entries."}
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (modal === "institution") {
                      await api("/timetable/config", {
                        method: "PUT",
                        body: values,
                      });
                      notify("Institution timetable defaults saved.");
                    } else {
                      const invalid = v.entries.some(
                        (e) =>
                          !values.slots.some(
                            (s) =>
                              s.day === e.day &&
                              s.period === e.period &&
                              s.kind === "class",
                          ),
                      );
                      if (invalid)
                        throw Error(
                          "Remove affected teaching entries before removing their periods.",
                        );
                      update({ config: values });
                    }
                    setModal(null);
                  })
                }
              >
                Save period settings
              </button>
            </>
          )}
          {modal === "preview" && preview && (
            <>
              <p>
                <b>
                  {cls?.course} · Section {cls?.section} · Semester {v.semester}
                </b>
                <br />
                {v.effective_from} through {v.effective_to}
              </p>
              <p>
                {preview.summary.added} new occurrences ·{" "}
                {preview.summary.removed} replaced/removed ·{" "}
                {preview.summary.unchanged} unchanged ·{" "}
                {preview.summary.exceptions_preserved} dated exceptions
                preserved.
              </p>
              <p>
                Published schedules become visible immediately. Holidays are
                skipped. Historical attendance stays unchanged. No external
                messages are sent.
              </p>
              {preview.errors.length ? (
                <div role="alert" className="timetable-error">
                  {preview.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              ) : (
                <p>No scheduling conflicts detected.</p>
              )}
              <p className="muted">
                Occurrence preview (up to the first 100 additions). The weekly
                grid shows the full recurring pattern.
              </p>
              <div className="publication-preview">
                {preview.sessions.map((s, i) => (
                  <p key={i}>
                    {dayLabel(s.date)} · {s.start}–{s.end} · Period {s.period} ·{" "}
                    {boot.subjects.find((x) => x.id === s.subject_id)?.name}
                  </p>
                ))}
              </div>
              <button
                className="button primary"
                disabled={busy || !!preview.errors.length}
                onClick={() =>
                  run(async () => {
                    const published = await api(`/timetables/${v.id}/publish`, {
                      method: "POST",
                      body: { revision: v.revision },
                    });
                    setVersions(await api("/timetables?class_id=" + classId));
                    setV(published);
                    setDirty(false);
                    setModal(null);
                    notify(
                      "Timetable published. Students and faculty can view their schedules.",
                    );
                  })
                }
              >
                {busy ? "Publishing…" : "Publish timetable"}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
