import React, { useEffect, useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { api, admin, dateLabel } from "./api";
const fields = [
  "name",
  "campus_id",
  "registration_number",
  "blood_group",
  "student_phone",
  "father_name",
  "father_phone",
  "mother_name",
  "mother_phone",
  "guardian_name",
  "guardian_phone",
  "address",
];
const label = (k) =>
  k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const markLabel = { P: "Present", A: "Absent", L: "Late", N: "Not enrolled" };
export default function StudentReport({
  studentId,
  user,
  boot,
  close,
  refresh,
  notify,
  ui,
}) {
  const { Form, Field, Select, Empty } = ui;
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [tab, setTab] = useState("attendance"),
    [month, setMonth] = useState(""),
    [subject, setSubject] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api(`/students/${studentId}/report`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studentId, reload]);
  useEffect(() => {
    const guard = (e) => {
      if (
        saving ||
        (dirty && !window.confirm("Discard unsaved student details?"))
      )
        e.preventDefault();
    };
    const unload = (e) => {
      if (dirty || saving) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("before-navigation", guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("before-navigation", guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, saving]);
  const leave = () => {
    if (
      !saving &&
      (!dirty || window.confirm("Discard unsaved student details?"))
    )
      close();
  };
  if (error)
    return (
      <section className="panel padded">
        <button className="button" onClick={leave}>
          Back to students
        </button>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => setReload(reload + 1)}>
          Retry
        </button>
      </section>
    );
  if (!data) return <p role="status">Loading student report…</p>;
  const s = data.student,
    total = data.subjects.reduce((n, x) => n + x.total, 0),
    attended = data.subjects.reduce((n, x) => n + x.attended, 0);
  const history = data.history.filter(
    (r) =>
      (!month || r.date.startsWith(month)) &&
      (!subject || r.subject_id === +subject) &&
      (!status || (status === "unmarked" ? !r.status : r.status === status)),
  );
  const options = [
    ...new Map(data.history.map((r) => [r.subject_id, r.subject])).entries(),
  ];
  return (
    <section className="student-report">
      <div className="section-toolbar">
        <button className="button" onClick={leave}>
          <ArrowLeft size={16} /> Back to students
        </button>
        {admin(user) && !editing && (
          <button
            className="button primary"
            onClick={() => {
              setTab("profile");
              setEditing(true);
            }}
          >
            <Pencil size={16} /> Edit student details
          </button>
        )}
      </div>
      <section className="panel padded">
        <h2>{s.name}</h2>
        <p>
          {s.campus_id} · {data.class.course} · Batch {data.class.section} ·
          Admission {data.class.admission_year}
        </p>
        <p className="muted">
          Registration: {s.registration_number || "Not provided"} · Class
          advisor: {data.class.advisor || "Unassigned"} · {s.status}
        </p>
        <div className="student-report-summary">
          <div>
            <strong>
              {total ? `${Math.round((attended / total) * 1000) / 10}%` : "—"}
            </strong>
            <span>Recorded attendance</span>
          </div>
          <div>
            <strong>
              {attended} / {total}
            </strong>
            <span>Sessions attended</span>
          </div>
          {data.can_view_leaves && (
            <div>
              <strong>{data.approved_leave_days}</strong>
              <span>Approved calendar days</span>
            </div>
          )}
        </div>
        <p className="muted">
          Attendance totals cover current-class subjects
          {user.role === "teacher" ? " assigned to you" : ""}. Approved leave
          does not automatically mark a student present. Leave days include
          weekends, future approved dates, and count overlapping dates once.
        </p>
      </section>
      <div className="tabs report-tabs">
        {[
          ["attendance", "Attendance"],
          ["history", "Session history"],
          ...(data.can_view_leaves ? [["leaves", "Leave history"]] : []),
          ["profile", "Student details"],
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            aria-pressed={tab === key}
            onClick={() => {
              if (key === tab || saving) return;
              if (
                editing &&
                dirty &&
                !window.confirm("Discard unsaved student details?")
              )
                return;
              setEditing(false);
              setDirty(false);
              setTab(key);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "attendance" && (
        <div className="student-attendance-cards">
          {data.subjects.map((sub) => (
            <article className="panel student-attendance-card" key={sub.id}>
              <h2>{sub.name}</h2>
              <p>
                {sub.code} · Semester {sub.semester}
              </p>
              <p className="muted">{sub.teacher || "Teacher unassigned"}</p>
              <div className="student-attendance-value">
                <strong>
                  {sub.percentage === null ? "—" : `${sub.percentage}%`}
                </strong>
                <span>
                  {sub.percentage === null
                    ? "No recorded sessions"
                    : sub.percentage < boot.threshold
                      ? "Below requirement"
                      : "On track"}
                </span>
              </div>
              <p>
                {sub.attended} attended · {sub.total - sub.attended} absent ·{" "}
                {sub.total} counted sessions
              </p>
              <button
                className="text-button"
                onClick={() => {
                  setSubject(String(sub.id));
                  setMonth("");
                  setStatus("");
                  setPage(0);
                  setTab("history");
                }}
              >
                View sessions
              </button>
            </article>
          ))}
          {!data.subjects.length && (
            <Empty
              title="No subjects"
              text="No accessible subjects are assigned to this class."
            />
          )}
        </div>
      )}
      {tab === "history" && (
        <section className="panel">
          <div className="report-filters">
            <label className="field">
              <span>Month (blank for all)</span>
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <Select
              label="Subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All subjects</option>
              {options.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              label="Mark"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All marks</option>
              {Object.entries(markLabel).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
              <option value="unmarked">Unmarked</option>
            </Select>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date / period</th>
                  <th>Subject</th>
                  <th>Mark</th>
                  <th>Session state</th>
                  <th>Counted</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(page * 50, page * 50 + 50).map((r) => (
                  <tr key={r.id}>
                    <td>
                      {dateLabel(r.date)}
                      <small className="subtext">Period {r.period}</small>
                    </td>
                    <td>{r.subject}</td>
                    <td>{markLabel[r.status] || "Unmarked"}</td>
                    <td>{r.state}</td>
                    <td>{r.counted ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.length && (
            <Empty
              title="No sessions"
              text="No sessions match these filters."
            />
          )}
          <div className="report-pagination">
            <span>
              {history.length} sessions · Page {page + 1} of{" "}
              {Math.max(1, Math.ceil(history.length / 50))}
            </span>
            <button
              className="button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="button"
              disabled={(page + 1) * 50 >= history.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
          <p className="panel-note">
            Drafts, future sessions, cancellations, unmarked cells and “Not
            enrolled” are excluded from percentages. Historical records from
            previous classes remain visible.
          </p>
        </section>
      )}
      {tab === "leaves" && data.can_view_leaves && (
        <section className="panel">
          {data.leaves.map((l) => (
            <article className="leave-card" key={l.id}>
              <div className="leave-top">
                <strong>
                  {dateLabel(l.from_date)} – {dateLabel(l.to_date)}
                </strong>
                <span className="badge">{l.status}</span>
              </div>
              <p>
                {l.category} leave ·{" "}
                {Math.round(
                  (Date.parse(l.to_date) - Date.parse(l.from_date)) / 86400000,
                ) + 1}{" "}
                calendar days
              </p>
              <p>{l.reason}</p>
              {l.reviewed_by && (
                <p className="muted">
                  {l.reviewer || "Former staff member"} ·{" "}
                  {l.review_note || "No review note"}
                </p>
              )}
            </article>
          ))}
          {!data.leaves.length && (
            <Empty
              title="No leave requests"
              text="Approved, pending and rejected requests will appear here."
            />
          )}
        </section>
      )}
      {tab === "profile" && (
        <section className="panel padded">
          {editing ? (
            <div onChange={() => setDirty(true)}>
              <h2>Edit student details</h2>
              <Form
                label="Save student details"
                onSubmit={async (b) => {
                  setSaving(true);
                  try {
                    await api(`/students/${s.id}`, {
                      method: "PATCH",
                      body: {
                        ...b,
                        class_id: +b.class_id,
                        revision: data.revision,
                      },
                    });
                    setDirty(false);
                    setEditing(false);
                    setReload(reload + 1);
                    refresh();
                    notify("Student details updated.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <div className="form-grid">
                  {fields.map((k) =>
                    k === "address" ? (
                      <label className="field" key={k}>
                        <span>Address</span>
                        <textarea
                          name={k}
                          defaultValue={s[k]}
                          maxLength={2000}
                        />
                      </label>
                    ) : (
                      <Field
                        key={k}
                        label={label(k)}
                        name={k}
                        defaultValue={s[k]}
                        required={["name", "campus_id"].includes(k)}
                        maxLength={
                          k.includes("phone")
                            ? 30
                            : k === "blood_group"
                              ? 20
                              : 200
                        }
                        type={k.includes("phone") ? "tel" : "text"}
                      />
                    ),
                  )}
                  <Select
                    label="Course / batch / admission"
                    name="class_id"
                    defaultValue={s.class_id}
                  >
                    {boot.classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.course} · {c.section} · {c.admission_year}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Student status"
                    name="status"
                    defaultValue={s.status}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </div>
                <p className="muted">
                  Class changes are blocked once attendance exists, to preserve
                  historical records. Student login credentials remain
                  unchanged.
                </p>
              </Form>
              <button
                className="button"
                disabled={saving}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Discard unsaved student details?")
                  ) {
                    setEditing(false);
                    setDirty(false);
                  }
                }}
              >
                Cancel editing
              </button>
            </div>
          ) : (
            <>
              <dl className="details">
                {fields
                  .filter((k) => k in s)
                  .map((k) => (
                    <React.Fragment key={k}>
                      <dt>{label(k)}</dt>
                      <dd>{s[k] || "Not provided"}</dd>
                    </React.Fragment>
                  ))}
              </dl>
              {admin(user) && (
                <Form
                  label="Save notification preference"
                  onSubmit={async (b) => {
                    await api(`/students/${s.id}/notifications`, {
                      method: "POST",
                      body: { phone: b.phone, consent: b.consent === "on" },
                    });
                    setReload(reload + 1);
                    refresh();
                    notify("Notification preference saved.");
                  }}
                >
                  <Field
                    label="WhatsApp recipient (international format)"
                    name="phone"
                    defaultValue={s.notification_phone}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name="consent"
                      defaultChecked={!!s.whatsapp_consent}
                    />{" "}
                    Recipient has explicitly opted in to attendance messages
                  </label>
                </Form>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
