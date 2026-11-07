import Timetable, { TodayClasses } from "./Timetable";
import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  CalendarDays,
  BookOpen,
  MailCheck,
  Settings,
  LogOut,
  Search,
  ChevronRight,
  ArrowUpRight,
  Download,
  Upload,
  Plus,
  Check,
  Clock,
  ShieldCheck,
  GraduationCap,
  Leaf,
  ArrowRight,
  AlertCircle,
  X,
  Menu,
  Send,
  FileSpreadsheet,
  CheckCircle2,
  Phone,
} from "lucide-react";
import { api, roleName, admin, dateLabel, initials } from "./api";
import universityLogo from "./assets/yenepoya-logo.svg";
import RegisterWorkspace from "./RegisterWorkspace";
import StudentReport from "./StudentReport";

const icons = {
  overview: LayoutDashboard,
  attendance: ClipboardCheck,
  students: Users,
  staff: Users,
  leaves: MailCheck,
  calendar: CalendarDays,
  academics: BookOpen,
  timetable: CalendarDays,
  notifications: Send,
  settings: Settings,
};
const labels = {
  overview: "Overview",
  attendance: "Attendance register",
  students: "Students",
  staff: "Staff directory",
  leaves: "Leave requests",
  calendar: "Academic calendar",
  academics: "Academic setup",
  timetable: "Timetable",
  notifications: "Notifications",
  settings: "Settings & access",
};
const Badge = ({ children, tone = "" }) => (
  <span className={"badge " + tone}>{children}</span>
);
const Empty = ({
  title = "Nothing here yet",
  text = "New records will appear here.",
}) => (
  <div className="empty">
    <Leaf size={30} />
    <h3>{title}</h3>
    <p>{text}</p>
  </div>
);
const Metric = ({ label, value, note, icon: Icon, tone = "" }) => (
  <div className="metric">
    <div className="metric-top">
      <span>{label}</span>
      <span className={"metric-icon " + tone}>
        <Icon size={18} />
      </span>
    </div>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>
);
function Modal({ title, children, close }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input aria-label={label} {...props} />
    </label>
  );
}
function Select({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} {...props}>
        {children}
      </select>
    </label>
  );
}
function Form({ onSubmit, children, label = "Save", initial = {} }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = {
          ...initial,
          ...Object.fromEntries(new FormData(e.currentTarget)),
        };
        try {
          await onSubmit(data);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <footer className="form-footer">
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : label}
          <ArrowRight size={16} />
        </button>
      </footer>
    </form>
  );
}
function Login({ onLogin }) {
  return (
    <div className="login">
      <section className="login-art">
        <div className="university-logo-container">
          <img
            className="university-logo"
            src={universityLogo}
            alt="Yenepoya University"
            width="1476"
            height="302.4"
          />
        </div>
        <div className="login-message">
          <span className="eyebrow">A LITTLE MORE PRESENT. EVERY DAY.</span>
          <h1>
            Every class counts.
            <br />
            Every student matters.
          </h1>
          <p>
            A connected space for attendance, student support, and a better
            academic experience.
          </p>
          <div className="art-grid">
            {Array.from({ length: 42 }, (_, i) => (
              <span key={i} className={i % 7 === 0 ? "absent" : ""}>
                {i % 7 === 0 ? "A" : <Check size={18} />}
              </span>
            ))}
          </div>
        </div>
        <small>Yenepoya University · Academic attendance portal</small>
      </section>
      <section className="login-form">
        <span className="eyebrow green">WELCOME BACK</span>
        <h2>Sign in to your campus</h2>
        <p>Use the account provided by your administrator.</p>
        <Form
          label="Sign in"
          onSubmit={async (b) => {
            const data = await api("/auth/login", { method: "POST", body: b });
            onLogin(data.user);
          }}
        >
          <Field
            label="Email or login ID"
            name="email"
            autoComplete="username"
            required
            placeholder="Your institutional login"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter your password"
          />
        </Form>
        <div className="login-note">
          <ShieldCheck size={18} />
          <span>Your access is based on your assigned campus role.</span>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null),
    [boot, setBoot] = useState(null),
    [page, setPage] = useState("overview"),
    [revision, setRevision] = useState(0),
    [initial, setInitial] = useState(true),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [classId, setClassId] = useState("");
  const [attendanceTarget, setAttendanceTarget] = useState(null);
  const refresh = () => setRevision((v) => v + 1),
    notify = (m) => {
      setToast(m);
      setTimeout(() => setToast(""), 5500);
    };
  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setInitial(false));
    const expired = () => {
      setUser(null);
      setBoot(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (user)
      api("/bootstrap")
        .then((d) => {
          setBoot(d);
          setClassId((c) => {
            let saved = "";
            try {
              saved = localStorage.getItem(`attendance-class:${user.id}`) || "";
            } catch {}
            return (
              [c, saved].find((value) =>
                d.classes.some((x) => String(x.id) === value),
              ) || String(d.classes[0]?.id || "")
            );
          });
        })
        .catch((e) => notify(e.message));
  }, [user, revision]);
  useEffect(() => {
    if (user && classId) {
      try {
        localStorage.setItem(`attendance-class:${user.id}`, classId);
      } catch {}
    }
  }, [user, classId]);
  const navigate = (p) => {
    if (
      !window.dispatchEvent(
        new Event("before-navigation", { cancelable: true }),
      )
    )
      return;
    if (p !== "attendance") setAttendanceTarget(null);
    setPage(p);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openScheduled = async (scheduled) => {
    if (
      !window.dispatchEvent(
        new Event("before-navigation", { cancelable: true }),
      )
    )
      return;
    const target = await api(`/schedule/${scheduled.id}/attendance`, {
      method: "POST",
    });
    setAttendanceTarget(target);
    setClassId(String(target.class_id));
    setPage("attendance");
  };
  if (initial) return <div className="loading">Opening your campus…</div>;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setPage("overview");
          setUser(u);
        }}
      />
    );
  if (!boot) return <div className="loading">Loading your workspace…</div>;
  const isStudent = user.role === "student",
    nav = [
      "overview",
      "attendance",
      ...(!isStudent ? ["students"] : []),
      "leaves",
      "calendar",
      ...(admin(user)
        ? ["staff", "academics", "timetable", "notifications"]
        : user.role === "student" || user.role === "teacher"
          ? ["timetable"]
          : []),
      "settings",
    ];
  const props = {
    boot,
    user,
    revision,
    refresh,
    notify,
    classId,
    setClassId,
    navigate,
    openScheduled,
    attendanceTarget,
  };
  return (
    <div
      className={
        "app-shell" +
        (isStudent
          ? " student-portal"
          : page === "attendance"
            ? " register-page"
            : "")
      }
    >
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="university-logo-container">
          <img
            className="university-logo"
            src={universityLogo}
            alt="Yenepoya University"
            width="1476"
            height="302.4"
          />
        </div>
        <div className="workspace-label">ACADEMIC WORKSPACE</div>
        <nav>
          {nav.map((p) => {
            const Icon = icons[p];
            return (
              <button
                key={p}
                className={page === p ? "active" : ""}
                onClick={() => navigate(p)}
              >
                <Icon size={19} />
                <span>
                  {isStudent && p === "attendance"
                    ? "My attendance"
                    : labels[p]}
                </span>
                {p === page && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="semester-note">
            <span className="tiny-dot" /> Academic year 2026–27
            <small>Growing together, every day.</small>
          </div>
          <button className="profile" onClick={() => navigate("settings")}>
            <span className="avatar">{initials(user.name)}</span>
            <span>
              <b>{user.name}</b>
              <small>{roleName(user.role)}</small>
            </span>
            <Settings size={16} />
          </button>
          <button
            className="signout"
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
                setBoot(null);
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile((v) => !v)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{labels[page]}</b>
          </div>
          <div className="top-right">
            <span className="campus-label">
              <span className="tiny-dot" /> University portal
            </span>
            <span className="header-date">
              {new Date(boot.today + "T00:00:00").toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="avatar small">{initials(user.name)}</span>
            {isStudent && (
              <button
                className="icon-button student-mobile-signout"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await api("/auth/logout", { method: "POST" });
                    setUser(null);
                    setBoot(null);
                  } catch (error) {
                    notify(error.message);
                  }
                }}
              >
                <LogOut size={20} />
              </button>
            )}
          </div>
        </header>
        <main key={page}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {isStudent
                  ? "YOUR ACADEMIC JOURNEY"
                  : "YENEPOYA · ATTENDANCE MANAGEMENT"}
              </span>
              <h1>
                {page === "overview"
                  ? isStudent
                    ? "Your learning, at a glance."
                    : "A clearer view of your campus."
                  : isStudent && page === "attendance"
                    ? "My attendance"
                    : labels[page]}
              </h1>
              <p>
                {
                  {
                    overview: isStudent
                      ? "Stay on top of your attendance and upcoming academic dates."
                      : "Keep attendance on track and give every student the support they need.",
                    attendance: isStudent
                      ? "Your attendance, subject by subject."
                      : "A familiar register. A simpler way to stay present.",
                    students:
                      "Your student directory, connected to every classroom.",
                    staff:
                      "Manage employee records, faculty assignments, and account access.",
                    leaves: "A thoughtful, transparent process for time away.",
                    calendar: "Important dates for the academic journey ahead.",
                    academics:
                      "Organize your courses, classes, subjects, and faculty.",
                    notifications:
                      "Keep students and families informed, with consent.",
                    settings: "Manage your account and campus access.",
                  }[page]
                }
              </p>
            </div>
            {!isStudent &&
              ["overview", "attendance", "students"].includes(page) && (
                <select
                  aria-label="Active class"
                  className="class-select"
                  value={classId}
                  onChange={(e) => {
                    if (
                      window.dispatchEvent(
                        new Event("before-navigation", { cancelable: true }),
                      )
                    )
                      setClassId(e.target.value);
                  }}
                >
                  {boot.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.course} · {c.section} · {c.admission_year}
                    </option>
                  ))}
                </select>
              )}
          </div>
          {page === "overview" && <TodayClasses {...props} />}
          {page === "overview" && <Overview {...props} />}
          {page === "timetable" && (
            <Timetable {...props} ui={{ Modal, Field, Select }} />
          )}
          {page === "attendance" && <Attendance {...props} />}
          {page === "students" && <Students {...props} />}
          {page === "staff" && <StaffDirectory {...props} />}
          {page === "leaves" && <Leaves {...props} />}
          {page === "calendar" && <Calendar {...props} />}
          {page === "academics" && <Academics {...props} />}
          {page === "notifications" && <Notifications {...props} />}
          {page === "settings" && <SettingsPage {...props} />}
          <div className="page-footer">
            <span>Yenepoya University</span>
            <span>Thoughtful systems. Better student experiences.</span>
          </div>
        </main>
      </div>
      {isStudent && (
        <nav className="student-bottom-nav" aria-label="Student navigation">
          {[
            ["overview", "Home"],
            ["attendance", "Attendance"],
            ["leaves", "Leave"],
            ["calendar", "Calendar"],
            ["settings", "Account"],
          ].map(([key, label]) => {
            const Icon = icons[key];
            return (
              <button
                key={key}
                aria-current={page === key ? "page" : undefined}
                className={page === key ? "active" : ""}
                onClick={() => navigate(key)}
              >
                <Icon size={21} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={18} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function useData(path, revision, notify) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    setData(null);
    if (path)
      api(path)
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => {
          if (active) notify(e.message);
        });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return data;
}
function Overview(p) {
  const { user, boot, classId, revision, notify, navigate } = p;
  const students = useData("/students?class_id=" + classId, revision, notify),
    leaves = useData("/leaves", revision, notify),
    events = useData("/calendar", revision, notify);
  if (!students || !leaves || !events)
    return <div className="loading-inline">Loading campus overview…</div>;
  const student = user.role === "student",
    sub = students.flatMap((s) => s.subjects),
    total = sub.reduce((n, s) => n + s.total, 0),
    attended = sub.reduce((n, s) => n + s.attended, 0),
    pct = total ? Math.round((attended / total) * 1000) / 10 : null,
    low = students.filter((s) =>
      s.subjects.some(
        (x) => x.percentage !== null && x.percentage < boot.threshold,
      ),
    ),
    pending = leaves.filter((l) => l.status === "pending"),
    selected = boot.classes.find((c) => c.id === +classId),
    upcoming = events.filter((e) => e.end_date >= boot.today).slice(0, 3);
  return (
    <>
      <section className="welcome-banner">
        <div>
          <span className="eyebrow">
            {student
              ? "MAKE EVERY SESSION COUNT"
              : "CONNECTED CLASSROOMS, SUPPORTED STUDENTS"}
          </span>
          <h2>
            {student
              ? `Hello, ${user.name.split(" ")[0]}.`
              : "Good things start with being present."}
          </h2>
          <p>
            {student
              ? "Your attendance and leave requests, all in one place."
              : `${selected?.course || "Your course"} · Section ${selected?.section || "—"} · Admission ${selected?.admission_year || "—"}`}
          </p>
          <button onClick={() => navigate("attendance")}>
            {student ? "View my attendance" : "Open attendance register"}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="orbit" />
          <div className="paper">
            <span />
            <span />
            <div>
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i}>
                  {i === 6 ? <Clock size={17} /> : <Check size={17} />}
                </i>
              ))}
            </div>
          </div>
          <span className="art-seal">
            <Check size={23} />
          </span>
        </div>
      </section>
      <div className="metrics">
        <Metric
          label={student ? "Subjects" : "Enrolled students"}
          value={student ? sub.length : students.length}
          note={
            student ? "Across your academic semesters" : "In the selected class"
          }
          icon={Users}
        />
        <Metric
          label="Recorded attendance"
          value={pct === null ? "—" : pct + "%"}
          note={`${attended.toLocaleString()} of ${total.toLocaleString()} recorded student-sessions`}
          icon={ClipboardCheck}
        />
        <Metric
          label={
            student ? "Subjects below threshold" : "Students needing attention"
          }
          value={
            student
              ? sub.filter(
                  (s) => s.percentage !== null && s.percentage < boot.threshold,
                ).length
              : low.length
          }
          note={`Below the ${boot.threshold}% attendance threshold`}
          icon={AlertCircle}
          tone="amber"
        />
        <Metric
          label="Pending leave requests"
          value={pending.length}
          note={
            student ? "Awaiting a decision" : "Across your accessible classes"
          }
          icon={MailCheck}
          tone="blue"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {student ? "Subject-wise attendance" : "Attendance at a glance"}
              </h2>
              <p>
                {student
                  ? "Based on recorded sessions"
                  : "Subject overview for your selected class"}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("attendance")}
            >
              {student ? "View attendance" : "View register"}
              <ArrowUpRight size={16} />
            </button>
          </div>
          {!sub.length ? (
            <Empty
              title="No subjects yet"
              text="Add subjects in Academic setup to get started."
            />
          ) : (
            <div className="subject-list">
              {boot.subjects
                .filter((s) => s.class_id === +classId)
                .map((s) => {
                  const records = sub.filter((x) => x.id === s.id),
                    t = records.reduce((a, b) => a + b.total, 0),
                    a = records.reduce((a, b) => a + b.attended, 0),
                    v = t ? Math.round((a / t) * 100) : null;
                  return (
                    <div className="subject-row" key={s.id}>
                      <span className="subject-icon">
                        <BookOpen size={20} />
                      </span>
                      <div className="subject-details">
                        <b>{s.name}</b>
                        <small>
                          {s.code} · {s.teacher || "Teacher unassigned"} ·
                          Semester {s.semester}
                        </small>
                        <div className="progress-track">
                          <span
                            className={v < boot.threshold ? "warning" : ""}
                            style={{ width: (v || 0) + "%" }}
                          />
                        </div>
                      </div>
                      <div className="subject-percent">
                        <strong>{v === null ? "—" : v + "%"}</strong>
                        <small>{t ? "recorded" : "No sessions"}</small>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          <div className="panel-note">
            <ShieldCheck size={16} /> Future sessions and unmarked cells are
            excluded from percentages.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Coming up</h2>
              <p>Your academic calendar</p>
            </div>
            <CalendarDays size={19} />
          </div>
          {upcoming.length ? (
            <div className="event-list">
              {upcoming.map((e) => (
                <div className="event-row" key={e.id}>
                  <div className="date-tile">
                    <b>{e.date.slice(-2)}</b>
                    <span>
                      {new Date(e.date + "T00:00:00").toLocaleDateString("en", {
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div>
                    <Badge tone={e.type === "holiday" ? "amber" : ""}>
                      {e.type}
                    </Badge>
                    <h3>{e.title}</h3>
                    <small>
                      {e.course ? `${e.course} · ${e.section}` : "All classes"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Room for what's next"
              text="Academic events will appear here once added."
            />
          )}
          <button className="panel-link" onClick={() => navigate("calendar")}>
            View academic calendar
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              {student
                ? "Your recent leave requests"
                : "Students who could use a check-in"}
            </h2>
            <p>
              {student
                ? "Follow the status of your requests"
                : `A little support goes a long way · Below ${boot.threshold}% in at least one subject`}
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => navigate(student ? "leaves" : "students")}
          >
            View all
            <ArrowRight size={16} />
          </button>
        </div>
        {student ? (
          <LeaveList leaves={leaves.slice(0, 3)} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>CAMPUS ID</th>
                  <th>SUBJECT</th>
                  <th>ATTENDANCE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {low.slice(0, 5).map((s) => {
                  const worst = s.subjects
                    .filter((x) => x.percentage !== null)
                    .sort((a, b) => a.percentage - b.percentage)[0];
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="person">
                          <span className="avatar pastel">
                            {initials(s.name)}
                          </span>
                          <b>{s.name}</b>
                        </div>
                      </td>
                      <td className="mono">{s.campus_id}</td>
                      <td>{worst.code}</td>
                      <td>
                        <b>{worst.percentage}%</b>
                        <small className="subtext">
                          {worst.attended} / {worst.total} sessions
                        </small>
                      </td>
                      <td>
                        <Badge tone="amber">Needs attention</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!low.length && (
              <Empty
                title="Everyone is on track"
                text="No recorded attendance below the threshold."
              />
            )}
          </div>
        )}
      </section>
    </>
  );
}

function StudentAttendance({ user, boot, revision, notify }) {
  const students = useData("/students", revision, notify);
  if (!students)
    return (
      <div className="loading-inline" role="status">
        Loading your attendance…
      </div>
    );
  const student = students.find((s) => s.id === user.student_id);
  const subjects = student?.subjects || [];
  return (
    <>
      <div className="info-strip">
        <ShieldCheck size={20} />
        <p>
          Required attendance: {boot.threshold}%. Only recorded sessions count.
          Approved leave does not automatically change attendance.
        </p>
      </div>
      {!subjects.length ? (
        <Empty
          title="No attendance yet"
          text="Your subjects will appear here when they are assigned."
        />
      ) : (
        <div className="student-attendance-cards">
          {subjects.map((subject) => {
            const low =
              subject.percentage !== null &&
              subject.percentage < boot.threshold;
            return (
              <article
                className="panel student-attendance-card"
                key={subject.id}
              >
                <div className="student-subject-heading">
                  <div>
                    <h2>{subject.name}</h2>
                    <p>
                      {subject.code} · Semester {subject.semester}
                    </p>
                  </div>
                  <BookOpen size={22} aria-hidden="true" />
                </div>
                <p className="muted">
                  {subject.teacher || "Teacher unassigned"}
                </p>
                <div className="student-attendance-value">
                  <strong>
                    {subject.percentage === null
                      ? "—"
                      : `${subject.percentage}%`}
                  </strong>
                  <Badge tone={low ? "amber" : ""}>
                    {subject.percentage === null
                      ? "No sessions"
                      : low
                        ? "Below requirement"
                        : "On track"}
                  </Badge>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <span
                    className={low ? "warning" : ""}
                    style={{ width: `${subject.percentage || 0}%` }}
                  />
                </div>
                <dl className="student-session-counts">
                  <div>
                    <dt>Attended</dt>
                    <dd>{subject.attended}</dd>
                  </div>
                  <div>
                    <dt>Absent</dt>
                    <dd>{subject.total - subject.attended}</dd>
                  </div>
                  <div>
                    <dt>Total sessions</dt>
                    <dd>{subject.total}</dd>
                  </div>
                </dl>
                <StudentSessionHistory
                  subject={subject}
                  user={user}
                  boot={boot}
                />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function StudentSessionHistory({ subject, user, boot }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [month, setMonth] = useState(boot.today.slice(0, 7));
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    api(`/attendance?subject_id=${subject.id}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [open, subject.id, retry]);
  const sessions =
    data?.sessions
      .filter((session) => !month || session.date.startsWith(month))
      .slice()
      .reverse() || [];
  return (
    <div className="student-session-history">
      <button
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide session history" : "View session history"}
      </button>
      {open && (
        <>
          <label className="field">
            <span>Session month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button className="button" onClick={() => setRetry(retry + 1)}>
                Retry
              </button>
            </div>
          ) : !data ? (
            <p role="status">Loading sessions…</p>
          ) : !sessions.length ? (
            <p>No sessions in this month.</p>
          ) : (
            <ul>
              {sessions.map((session) => {
                const mark = data.marks.find(
                  (m) =>
                    m.session_id === session.id &&
                    m.student_id === user.student_id,
                )?.status;
                const recorded =
                  ["submitted", "imported"].includes(session.state) &&
                  session.date <= boot.today;
                const label =
                  session.state === "cancelled"
                    ? "Cancelled"
                    : !recorded
                      ? "Not final"
                      : {
                          P: "Present",
                          A: "Absent",
                          L: "Late",
                          N: "Not enrolled",
                        }[mark] || "Unmarked";
                return (
                  <li key={session.id}>
                    <span>
                      {dateLabel(session.date)}
                      <small>Period {session.period}</small>
                    </span>
                    <Badge
                      tone={
                        label === "Absent"
                          ? "red"
                          : label === "Late"
                            ? "amber"
                            : ""
                      }
                    >
                      {label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Attendance(props) {
  if (props.user.role === "student") return <StudentAttendance {...props} />;
  return (
    <RegisterWorkspace {...props} ui={{ Modal, Form, Field, Select, Empty }} />
  );
}

function Students({ boot, user, classId, revision, refresh, notify }) {
  const students = useData("/students?class_id=" + classId, revision, notify),
    [search, setSearch] = useState(""),
    [importing, setImporting] = useState(false),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const body = new FormData();
      body.append("file", file);
      setPreview(await api("/import/preview", { method: "POST", body }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (detail)
    return (
      <StudentReport
        studentId={detail.id}
        user={user}
        boot={boot}
        close={() => setDetail(null)}
        refresh={refresh}
        notify={notify}
        ui={{ Form, Field, Select, Empty }}
      />
    );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Student directory{" "}
              <span className="count">{students?.length || 0}</span>
            </h2>
            <p>Student records for the selected class</p>
          </div>
          <div className="button-row">
            <a
              className="button"
              href={"/api/reports/export?class_id=" + classId}
            >
              <Download size={16} /> Attendance report
            </a>
            {admin(user) && (
              <button
                className="button primary"
                onClick={() => setImporting(true)}
              >
                <Upload size={16} /> Import students
              </button>
            )}
          </div>
        </div>
        <div className="directory-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search students"
              placeholder="Search name or campus ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Badge>
            Admission{" "}
            {boot.classes.find((c) => c.id === +classId)?.admission_year || "—"}
          </Badge>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>STUDENT</th>
                <th>CAMPUS ID</th>
                <th>COURSE / BATCH</th>
                <th>ATTENDANCE</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students
                ?.filter((s) =>
                  (s.name + s.campus_id)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((s) => {
                  const total = s.subjects.reduce((a, b) => a + b.total, 0),
                    att = s.subjects.reduce((a, b) => a + b.attended, 0),
                    pct = total ? Math.round((att / total) * 100) : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="person">
                          <span className="avatar pastel">
                            {initials(s.name)}
                          </span>
                          <b>{s.name}</b>
                        </div>
                      </td>
                      <td className="mono">{s.campus_id}</td>
                      <td>
                        {s.course} · {s.section}
                        <small className="subtext">
                          {s.admission_year} admission
                        </small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            pct !== null && pct < boot.threshold ? "amber" : ""
                          }
                        >
                          {pct === null ? "No records" : pct + "%"}
                        </Badge>
                      </td>
                      <td>
                        <span className="status-dot" />
                        {s.status}
                      </td>
                      <td>
                        <button
                          className="button"
                          aria-label={`View report for ${s.name}`}
                          onClick={() => setDetail(s)}
                        >
                          <ArrowUpRight size={17} /> View report
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {students?.length === 0 && (
            <Empty
              title="Your class starts here"
              text="Import a student workbook to populate the directory."
            />
          )}
        </div>
      </section>
      {importing && (
        <Modal
          title="Import students from Excel"
          close={() => {
            setImporting(false);
            setPreview(null);
            setError("");
          }}
        >
          <p className="muted">
            Create the course and class first. Campus ID identifies existing
            students. All rows must pass validation before import.
          </p>
          <a className="button" href="/api/import/template">
            <Download size={16} /> Download Excel template
          </a>
          <label className="upload-zone">
            <Upload size={28} />
            <b>{busy ? "Reading workbook…" : "Choose your .xlsx workbook"}</b>
            <span>Up to 8 MB · First worksheet · 10,000 rows maximum</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(e) => upload(e.target.files[0])}
            />
          </label>
          {error && <div className="error">{error}</div>}
          {preview && (
            <>
              <div className="import-summary">
                <Badge tone={preview.valid ? "" : "amber"}>
                  {preview.valid
                    ? "Ready to import"
                    : "Fix errors before importing"}
                </Badge>
                <p>
                  {preview.rows.filter((r) => r.action === "create").length} new
                  · {preview.rows.filter((r) => r.action === "update").length}{" "}
                  updates · {preview.rows.filter((r) => r.errors.length).length}{" "}
                  rows with errors
                </p>
              </div>
              <div className="preview-rows">
                {preview.rows.slice(0, 100).map((r) => (
                  <div key={r.row}>
                    <b>
                      Row {r.row} · {r.data.name || "Missing name"}
                    </b>
                    <small>
                      {r.data.campus_id} · {r.action}
                    </small>
                    {r.errors.map((e) => (
                      <p className="error-text" key={e}>
                        {e}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <p className="muted">
                Preview shows the first 100 rows. Import applies all{" "}
                {preview.rows.length} validated rows. Blank optional fields
                replace existing values.
              </p>
              <button
                className="button primary"
                disabled={!preview.valid || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api("/import/commit", {
                      method: "POST",
                      body: { token: preview.token },
                    });
                    setImporting(false);
                    setPreview(null);
                    refresh();
                    notify(`${r.count} student records imported.`);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {preview.rows.length} students
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function LeaveList({ leaves, onReview, onContact }) {
  if (!leaves.length)
    return (
      <Empty
        title="No leave requests"
        text="Requests and decisions will appear here."
      />
    );
  return (
    <div className="leave-list">
      {leaves.map((l) => (
        <article className="leave-card" key={l.id}>
          <div className="leave-top">
            <div className="person">
              <span className="avatar pastel">{initials(l.name)}</span>
              <div>
                <b>{l.name}</b>
                <small>
                  {l.course} · {l.section} · {l.campus_id}
                </small>
              </div>
            </div>
            <Badge
              tone={
                l.status === "pending"
                  ? "amber"
                  : l.status === "rejected"
                    ? "red"
                    : ""
              }
            >
              {l.status}
            </Badge>
          </div>
          <div className="leave-dates">
            <CalendarDays size={16} />
            {dateLabel(l.from_date)} – {dateLabel(l.to_date)}
            <span>·</span>
            {l.category} leave
          </div>
          <p>{l.reason}</p>
          {l.reviewed_by && (
            <div className="review-note">
              <CheckCircle2 size={16} />
              <span>
                {l.reviewer} · {l.status}
                {l.review_note && ` — ${l.review_note}`}
              </span>
            </div>
          )}
          {onReview && l.status === "pending" && (
            <div className="button-row">
              <button
                className="button"
                onClick={() => onContact(l, "student")}
              >
                <Phone size={15} /> Call student
              </button>
              <button className="button" onClick={() => onContact(l, "parent")}>
                <Phone size={15} /> Call parent
              </button>
              <button
                className="button"
                onClick={() => onReview({ ...l, decision: "rejected" })}
              >
                Reject
              </button>
              <button
                className="button primary"
                onClick={() => onReview({ ...l, decision: "approved" })}
              >
                <Check size={15} /> Approve leave
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
function Leaves({ user, boot, revision, notify, refresh }) {
  const leaves = useData("/leaves", revision, notify),
    [filter, setFilter] = useState("all"),
    [request, setRequest] = useState(false),
    [review, setReview] = useState(null),
    [contact, setContact] = useState(null);
  useEffect(() => {
    if (!contact?.id) return;
    let cancelled = false;
    api(`/leaves/${contact.id}/contacts`).then(
      (data) => {
        if (!cancelled) setContact((current) => ({ ...current, data }));
      },
      (error) => {
        if (!cancelled)
          setContact((current) => ({ ...current, error: error.message }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [contact?.id, contact?.kind]);
  return (
    <>
      <div className="section-toolbar">
        <div className="tabs">
          {["all", "pending", "approved", "rejected"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
              <span>
                {leaves?.filter((l) => f === "all" || l.status === f).length ||
                  0}
              </span>
            </button>
          ))}
        </div>
        {user.role === "student" && (
          <button className="button primary" onClick={() => setRequest(true)}>
            <Plus size={16} /> Request leave
          </button>
        )}
      </div>
      <section className="panel">
        {leaves ? (
          <LeaveList
            leaves={leaves.filter(
              (l) => filter === "all" || l.status === filter,
            )}
            onReview={admin(user) || user.role === "welfare" ? setReview : null}
            onContact={(leave, kind) =>
              setContact({ id: leave.id, name: leave.name, kind })
            }
          />
        ) : (
          <div className="loading-inline">Loading requests…</div>
        )}
      </section>
      <div className="info-strip">
        <ShieldCheck size={20} />
        <p>
          Either an administrator or student welfare officer can review a
          request. Approved leave does not automatically change attendance.
        </p>
      </div>
      {contact && (
        <Modal
          title={contact.kind === "student" ? "Call student" : "Call parent"}
          close={() => setContact(null)}
        >
          <p>
            {contact.name}
            {contact.data && ` · ${contact.data.campus_id}`}
          </p>
          {contact.error ? (
            <p role="alert">{contact.error}</p>
          ) : !contact.data ? (
            <p role="status">Loading contact numbers…</p>
          ) : (
            <div className="leave-contacts">
              {(contact.kind === "student"
                ? ["student"]
                : ["father", "mother", "guardian"]
              ).map((kind) => {
                const number = contact.data[`${kind}_phone`]?.trim();
                const name =
                  kind === "student"
                    ? contact.data.name
                    : contact.data[`${kind}_name`];
                const dial = number?.replace(/[^\d+]/g, "");
                return (
                  <div className="leave-contact" key={kind}>
                    <div>
                      <strong>
                        {kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </strong>
                      {name && <span>{name}</span>}
                    </div>
                    {number ? (
                      <a
                        href={
                          dial && /\d/.test(dial) ? `tel:${dial}` : undefined
                        }
                      >
                        {number}
                      </a>
                    ) : (
                      <span className="muted">Number not recorded</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
      {request && (
        <Modal title="Request leave" close={() => setRequest(false)}>
          <Form
            label="Submit request"
            onSubmit={async (b) => {
              await api("/leaves", { method: "POST", body: b });
              setRequest(false);
              refresh();
              notify("Leave request submitted.");
            }}
          >
            <div className="form-grid">
              <Field
                label="From date"
                name="from_date"
                type="date"
                defaultValue={boot.today}
                required
              />
              <Field
                label="To date"
                name="to_date"
                type="date"
                defaultValue={boot.today}
                required
              />
            </div>
            <Select label="Leave category" name="category">
              <option value="personal">Personal</option>
              <option value="medical">Medical</option>
              <option value="duty">On duty</option>
            </Select>
            <label className="field">
              <span>Reason</span>
              <textarea
                name="reason"
                minLength="10"
                maxLength="2000"
                rows="4"
                required
                placeholder="Explain the reason for your leave (at least 10 characters)."
              />
            </label>
          </Form>
        </Modal>
      )}
      {review && (
        <Modal
          title={
            review.decision === "approved" ? "Approve leave" : "Reject leave"
          }
          close={() => setReview(null)}
        >
          <p>
            {review.name} · {dateLabel(review.from_date)} –{" "}
            {dateLabel(review.to_date)}
          </p>
          <Form
            label="Confirm decision"
            onSubmit={async (b) => {
              await api("/leaves/" + review.id + "/review", {
                method: "POST",
                body: { status: review.decision, note: b.note },
              });
              setReview(null);
              refresh();
              notify("Leave decision saved.");
            }}
          >
            <label className="field">
              <span>
                {review.decision === "rejected"
                  ? "Reason for rejection"
                  : "Note to the student (optional)"}
              </span>
              <textarea
                name="note"
                required={review.decision === "rejected"}
                maxLength="1000"
                rows="4"
              />
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}

function Calendar({ boot, user, revision, notify, refresh }) {
  const events = useData("/calendar", revision, notify),
    [month, setMonth] = useState(boot.today.slice(0, 7)),
    [adding, setAdding] = useState(false);
  const [y, m] = month.split("-").map(Number),
    first = new Date(y, m - 1, 1).getDay(),
    days = new Date(y, m, 0).getDate();
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              {new Date(y, m - 1).toLocaleDateString("en-IN", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <p>Academic dates, examinations, and holidays</p>
          </div>
          <div className="button-row">
            <input
              aria-label="Calendar month"
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
            {admin(user) && (
              <button
                className="button primary"
                onClick={() => setAdding(true)}
              >
                <Plus size={16} /> Add event
              </button>
            )}
          </div>
        </div>
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div className="weekday" key={d}>
                {d}
              </div>
            ))}
            {Array.from({ length: first }, (_, i) => (
              <div className="day empty-day" key={"empty" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, "0")}`;
              return (
                <div
                  className={"day " + (date === boot.today ? "today" : "")}
                  key={date}
                >
                  <span>{i + 1}</span>
                  {events
                    ?.filter((e) => e.date <= date && e.end_date >= date)
                    .map((e) => (
                      <div
                        className={"calendar-event " + e.type}
                        key={e.id}
                        title={e.description}
                      >
                        {e.title}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="panel calendar-agenda">
        <div className="panel-heading">
          <h2>This month's agenda</h2>
        </div>
        {events
          ?.filter(
            (e) => e.date <= `${month}-31` && e.end_date >= `${month}-01`,
          )
          .map((e) => (
            <div className="agenda-row" key={e.id}>
              <div>
                <Badge tone={e.type === "holiday" ? "amber" : ""}>
                  {e.type}
                </Badge>
                <h3>{e.title}</h3>
                <p>
                  {dateLabel(e.date)} – {dateLabel(e.end_date)} ·{" "}
                  {e.course ? `${e.course} ${e.section}` : "All classes"}
                </p>
                {e.description && <p>{e.description}</p>}
              </div>
              {admin(user) && (
                <button
                  className="icon-button"
                  aria-label={`Delete ${e.title}`}
                  onClick={async () => {
                    if (!window.confirm("Delete this calendar event?")) return;
                    try {
                      await api("/calendar/" + e.id, { method: "DELETE" });
                      refresh();
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
        {events &&
          !events.some(
            (e) => e.date <= `${month}-31` && e.end_date >= `${month}-01`,
          ) && (
            <Empty
              title="A fresh page"
              text="There are no academic events scheduled for this month."
            />
          )}
      </section>
      {adding && (
        <Modal title="Add academic event" close={() => setAdding(false)}>
          <Form
            onSubmit={async (b) => {
              await api("/calendar", {
                method: "POST",
                body: { ...b, class_id: b.class_id ? +b.class_id : null },
              });
              setAdding(false);
              refresh();
              notify("Calendar event added.");
            }}
          >
            <Field label="Event title" name="title" required />
            <div className="form-grid">
              <Field
                label="Start date"
                name="date"
                type="date"
                defaultValue={boot.today}
                required
              />
              <Field
                label="End date"
                name="end_date"
                type="date"
                defaultValue={boot.today}
                required
              />
            </div>
            <Select label="Type" name="type">
              <option value="academic">Academic</option>
              <option value="exam">Examination</option>
              <option value="holiday">Holiday</option>
              <option value="event">Event</option>
            </Select>
            <Select label="Audience" name="class_id">
              <option value="">All classes</option>
              {boot.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.course} · {c.section} · {c.admission_year}
                </option>
              ))}
            </Select>
            <Field label="Description" name="description" />
          </Form>
        </Modal>
      )}
    </>
  );
}

function Academics({ boot, refresh, notify }) {
  const [modal, setModal] = useState(null);
  const staffOptions = (
    <>
      <option value="">Unassigned</option>
      {boot.staff
        .filter((s) => s.active)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({roleName(s.role)})
          </option>
        ))}
    </>
  );
  return (
    <>
      <div className="section-toolbar">
        <span className="muted">
          {boot.courses.length} courses · {boot.classes.length} classes ·{" "}
          {boot.subjects.length} subjects
        </span>
        <div className="button-row">
          <button
            className="button"
            onClick={() => setModal({ kind: "course" })}
          >
            <Plus size={16} /> Course
          </button>
          <button
            className="button"
            onClick={() => setModal({ kind: "class" })}
          >
            <Plus size={16} /> Class
          </button>
          <button
            className="button primary"
            onClick={() => setModal({ kind: "subject" })}
          >
            <Plus size={16} /> Subject
          </button>
        </div>
      </div>
      {boot.courses.map((course) => (
        <section className="panel academic-course" key={course.id}>
          <div className="panel-heading">
            <div className="person">
              <span className="course-icon">
                <GraduationCap size={24} />
              </span>
              <div>
                <h2>{course.code}</h2>
                <p>{course.name}</p>
              </div>
            </div>
            <Badge>
              {boot.classes.filter((c) => c.course_id === course.id).length}{" "}
              classes
            </Badge>
          </div>
          {boot.classes
            .filter((c) => c.course_id === course.id)
            .map((c) => (
              <div className="class-block" key={c.id}>
                <div className="class-heading">
                  <div>
                    <h3>
                      Section {c.section}{" "}
                      <span>· Admission {c.admission_year}</span>
                    </h3>
                    <p>
                      Semester {c.semester} · Class advisor:{" "}
                      {c.advisor || "Unassigned"}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setModal({ kind: "assignment", record: c })}
                  >
                    Edit class
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="subject-chips">
                  {boot.subjects
                    .filter((s) => s.class_id === c.id)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setModal({ kind: "teacher", record: s })}
                      >
                        <BookOpen size={17} />
                        <div>
                          <b>{s.name}</b>
                          <small>
                            {s.code} · Semester {s.semester} ·{" "}
                            {s.teacher || "Assign teacher"}
                          </small>
                        </div>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  {!boot.subjects.some((s) => s.class_id === c.id) && (
                    <p className="muted">No subjects assigned yet.</p>
                  )}
                </div>
              </div>
            ))}
        </section>
      ))}
      {modal && (
        <Modal
          title={
            {
              course: "Add course",
              class: "Add class",
              subject: "Add subject",
              assignment: "Edit class assignment",
              teacher: "Assign subject teacher",
            }[modal.kind]
          }
          close={() => setModal(null)}
        >
          <Form
            onSubmit={async (b) => {
              const kind = modal.kind;
              let path,
                method = "POST",
                body = b;
              if (kind === "course") path = "/courses";
              if (kind === "class") {
                path = "/classes";
                body = {
                  ...b,
                  advisor_id: b.advisor_id ? +b.advisor_id : null,
                };
              }
              if (kind === "subject") {
                path = "/subjects";
                body = {
                  ...b,
                  teacher_id: b.teacher_id ? +b.teacher_id : null,
                };
              }
              if (kind === "assignment") {
                path = "/classes/" + modal.record.id;
                method = "PATCH";
                body = {
                  ...b,
                  advisor_id: b.advisor_id ? +b.advisor_id : null,
                };
              }
              if (kind === "teacher") {
                path = "/subjects/" + modal.record.id;
                method = "PATCH";
                body = { teacher_id: b.teacher_id ? +b.teacher_id : null };
              }
              await api(path, { method, body });
              setModal(null);
              refresh();
              notify("Academic setup saved.");
            }}
          >
            {modal.kind === "course" && (
              <>
                <Field
                  label="Course code"
                  name="code"
                  placeholder="BCA"
                  required
                />
                <Field
                  label="Course name"
                  name="name"
                  placeholder="Bachelor of Computer Applications"
                  required
                />
              </>
            )}
            {modal.kind === "class" && (
              <>
                <Select label="Course" name="course_id" required>
                  {boot.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
                <div className="form-grid">
                  <Field
                    label="Admission year"
                    name="admission_year"
                    type="number"
                    min="2000"
                    max="2100"
                    defaultValue="2026"
                    required
                  />
                  <Field
                    label="Section / batch"
                    name="section"
                    placeholder="A"
                    required
                  />
                </div>
              </>
            )}
            {["class", "assignment"].includes(modal.kind) && (
              <>
                <Field
                  label="Current semester"
                  name="semester"
                  type="number"
                  min="1"
                  max="12"
                  defaultValue={modal.record?.semester || 1}
                  required
                />
                <Select
                  label="Class advisor"
                  name="advisor_id"
                  defaultValue={modal.record?.advisor_id || ""}
                >
                  {staffOptions}
                </Select>
              </>
            )}
            {modal.kind === "subject" && (
              <>
                <Select label="Class" name="class_id" required>
                  {boot.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.course} · {c.section} · {c.admission_year}
                    </option>
                  ))}
                </Select>
                <Field label="Subject name" name="name" required />
                <div className="form-grid">
                  <Field label="Subject code" name="code" required />
                  <Field
                    label="Semester"
                    name="semester"
                    type="number"
                    min="1"
                    max="12"
                    defaultValue="1"
                    required
                  />
                </div>
              </>
            )}
            {["subject", "teacher"].includes(modal.kind) && (
              <Select
                label="Subject teacher"
                name="teacher_id"
                defaultValue={modal.record?.teacher_id || ""}
              >
                <option value="">Unassigned</option>
                {boot.staff
                  .filter((s) => s.active && s.role === "teacher")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}

function Notifications({ revision, notify }) {
  const data = useData("/notifications", revision, notify),
    [local, setLocal] = useState(0);
  const fresh = useData("/notifications", local + revision, notify);
  return (
    <>
      <div className="info-strip">
        <ShieldCheck size={21} />
        <p>
          <b>
            {(fresh || data)?.mode === "live"
              ? "Live messaging configured"
              : "Dry-run mode — no messages are sent."}
          </b>{" "}
          Only recipients with a recorded opt-in are queued. Connect your
          WhatsApp Business account and approved template in the server
          configuration to enable delivery.
        </p>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Notification activity</h2>
            <p>Absence alerts, leave decisions, and attendance summaries</p>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => setLocal((n) => n + 1)}>
              Refresh
            </button>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await api("/notifications/summary", { method: "POST" });
                  setLocal((n) => n + 1);
                  notify(
                    "Low-attendance summaries queued for opted-in recipients.",
                  );
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              <Send size={16} /> Queue low-attendance alerts
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>STUDENT</th>
                <th>TYPE</th>
                <th>STATUS</th>
                <th>ATTEMPTS</th>
                <th>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {fresh?.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.name}</td>
                  <td>{j.kind.replaceAll("_", " ")}</td>
                  <td>
                    <Badge
                      tone={
                        ["failed", "needs_review"].includes(j.status)
                          ? "amber"
                          : ""
                      }
                    >
                      {j.status.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td>{j.attempts}</td>
                  <td>{j.last_error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!fresh?.jobs.length && (
            <Empty
              title="Quiet, for now"
              text="Messages appear here after attendance submissions or leave decisions for opted-in recipients."
            />
          )}
        </div>
        <div className="panel-note">
          “Sent” means accepted by the provider; delivery and read receipts
          require a webhook integration.
        </div>
      </section>
    </>
  );
}

function StaffImport({ close, refresh, notify }) {
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const upload = async (file) => {
    setPreview(null);
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      setPreview(await api("/staff/import/preview", { method: "POST", body }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import staff from Excel"
      close={() => {
        if (!busy) close();
      }}
    >
      <p>
        Create up to 250 staff accounts per workbook. Include a password of
        8–128 characters for each account. Existing accounts are not
        overwritten.
      </p>
      <a className="button" href="/api/staff/import/template">
        <Download size={16} /> Download staff template
      </a>
      <label className="upload-zone">
        <Upload size={22} />
        <span>
          {busy ? "Processing…" : "Choose a completed Excel workbook"}
        </span>
        <input
          aria-label="Staff workbook"
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => upload(e.target.files[0])}
        />
      </label>
      <p className="muted">
        Use the Subjects sheet to look up IDs for optional subject assignments.
        Passwords are hidden in this preview.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            {preview.rows.length} staff rows ·{" "}
            {preview.rows.filter((r) => r.errors.length).length} rows with
            errors
          </p>
          <div className="table-wrap staff-import-preview">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Staff / email</th>
                  <th>Department / position</th>
                  <th>Role / subjects</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      <b>{r.data.name}</b>
                      <small className="subtext">{r.data.employee_code}</small>
                      <small className="subtext">{r.data.email}</small>
                    </td>
                    <td>
                      {r.data.department}
                      <small className="subtext">{r.data.position}</small>
                    </td>
                    <td>
                      {r.data.role}
                      <small className="subtext">
                        {r.data.subject_ids.join(", ") || "No subjects"}
                      </small>
                    </td>
                    <td>{r.errors.length ? r.errors.join("; ") : "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-footer">
            <button
              className="button primary"
              disabled={busy || !preview.valid}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api("/staff/import/commit", {
                    method: "POST",
                    body: { token: preview.token },
                  });
                  refresh();
                  notify(`${result.created} staff accounts imported.`);
                  close();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Processing…"
                : `Import ${preview.rows.length} staff accounts`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function StaffDirectory({ boot, user, revision, refresh, notify }) {
  const staff = useData("/staff", revision, notify);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [editing, setEditing] = useState(null),
    [reset, setReset] = useState(null),
    [role, setRole] = useState("teacher"),
    [selected, setSelected] = useState([]),
    [subjectSearch, setSubjectSearch] = useState("");
  const start = (member) => {
    setEditing(member || {});
    setRole(member?.role || "teacher");
    setSelected(member?.subjects.map((s) => s.id) || []);
    setSubjectSearch("");
  };
  const canEdit = (s) =>
    s.role !== "master_admin" &&
    (s.role !== "admin" || user.role === "master_admin");
  const classLabel = (id) => {
    const c = boot.classes.find((c) => c.id === id);
    return c ? `${c.course} · ${c.section} · ${c.admission_year}` : "";
  };
  const filtered = staff?.filter(
    (s) =>
      (status === "all" || !!s.active === (status === "active")) &&
      [s.name, s.employee_code, s.department, s.position, s.email]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      {importing && (
        <StaffImport
          close={() => setImporting(false)}
          refresh={refresh}
          notify={notify}
        />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Staff directory{" "}
              <span className="count">{staff?.length || 0}</span>
            </h2>
            <p>Employee profiles and faculty access in one place.</p>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => setImporting(true)}>
              <Upload size={16} /> Import staff
            </button>
            <button className="button primary" onClick={() => start(null)}>
              <Plus size={16} /> Add staff
            </button>
          </div>
        </div>
        <div className="directory-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search staff"
              placeholder="Name, employee code, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Staff status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All staff</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="data-table staff-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>DEPARTMENT / POSITION</th>
                <th>SUBJECTS</th>
                <th>ACCESS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="person">
                      <span className="avatar pastel">{initials(s.name)}</span>
                      <div>
                        <b>{s.name}</b>
                        <small>
                          {s.employee_code || "Employee code not added"}
                        </small>
                        <small>{s.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {s.department || "Not provided"}
                    <small className="subtext">
                      {s.position || "Not provided"}
                    </small>
                    {!s.employee_code && s.role !== "master_admin" && (
                      <Badge tone="amber">Complete profile</Badge>
                    )}
                  </td>
                  <td>
                    <div className="staff-subjects">
                      {s.subjects.length ? (
                        s.subjects.map((subject) => (
                          <span key={subject.id}>
                            <b>{subject.name}</b>
                            <small>
                              {subject.course} · {subject.section} ·{" "}
                              {subject.admission_year} · Sem {subject.semester}
                            </small>
                          </span>
                        ))
                      ) : (
                        <span className="muted">
                          {s.role === "teacher"
                            ? "No subjects assigned"
                            : "Not a faculty account"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <Badge tone={s.active ? "" : "red"}>
                      {s.active ? "Active" : "Inactive"}
                    </Badge>
                    <small className="subtext">{roleName(s.role)}</small>
                  </td>
                  <td>
                    {canEdit(s) ? (
                      <div className="button-row">
                        <button className="button" onClick={() => start(s)}>
                          Edit
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setReset(s)}
                        >
                          Reset password
                        </button>
                      </div>
                    ) : (
                      <span className="muted">Protected account</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {staff && !filtered.length && (
            <Empty
              title="No matching staff"
              text="Try a different name, department, or status."
            />
          )}
          {!staff && <div className="loading-inline">Loading staff…</div>}
        </div>
      </section>
      <div className="info-strip">
        <ShieldCheck size={20} />
        <p>
          Faculty can view and mark only their assigned subjects, including
          subjects in different classes. Deactivating a staff account
          immediately signs it out and blocks login. Existing attendance history
          is retained.
        </p>
      </div>
      {editing && (
        <Modal
          title={editing.id ? "Edit staff member" : "Add staff member"}
          close={() => setEditing(null)}
        >
          <Form
            label={editing.id ? "Save staff details" : "Create staff account"}
            onSubmit={async (b) => {
              const body = {
                name: b.name,
                email: b.email,
                employee_code: b.employee_code,
                department: b.department,
                position: b.position,
                active: b.active === "true",
                subject_ids: role === "teacher" ? selected : [],
                ...(editing.id
                  ? { revision: editing.staff_revision }
                  : { role, password: b.password }),
              };
              await api(editing.id ? "/staff/" + editing.id : "/staff", {
                method: editing.id ? "PATCH" : "POST",
                body,
              });
              setEditing(null);
              refresh();
              notify(
                editing.id
                  ? "Staff details and assignments updated."
                  : "Staff account created. Share the initial credentials securely.",
              );
            }}
          >
            <div className="form-grid">
              <Field
                label="Employee code"
                name="employee_code"
                defaultValue={editing.employee_code || ""}
                maxLength="40"
                placeholder="EMP001"
                required
              />
              <Field
                label="Full name"
                name="name"
                defaultValue={editing.name || ""}
                required
              />
            </div>
            <div className="form-grid">
              <Field
                label="Department"
                name="department"
                defaultValue={editing.department || ""}
                placeholder="Computer Applications"
                required
              />
              <Field
                label="Position / designation"
                name="position"
                defaultValue={editing.position || ""}
                placeholder="Assistant Professor"
                required
              />
            </div>
            <Field
              label="Email or login ID"
              name="email"
              defaultValue={editing.email || ""}
              required
            />
            {!editing.id ? (
              <>
                <Select
                  label="Access role"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="teacher">Faculty</option>
                  <option value="welfare">Student welfare officer</option>
                  {user.role === "master_admin" && (
                    <option value="admin">Academic administrator</option>
                  )}
                </Select>
                <Field
                  label="Initial password (8+ characters)"
                  name="password"
                  type="password"
                  minLength="8"
                  maxLength="128"
                  autoComplete="new-password"
                  required
                />
              </>
            ) : (
              <p className="muted">Access role: {roleName(role)}</p>
            )}
            <Select
              label="Account status"
              name="active"
              defaultValue={editing.active === 0 ? "false" : "true"}
            >
              <option value="true">Active — login allowed</option>
              <option value="false">Inactive — login blocked</option>
            </Select>
            {role === "teacher" && (
              <fieldset className="staff-assignment">
                <legend>Assigned subjects ({selected.length})</legend>
                <p className="muted">
                  Choose any number of subjects. Subjects assigned to another
                  teacher must first be reassigned in Academic setup.
                </p>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Find subjects to assign"
                    placeholder="Search subject, course or class…"
                    value={subjectSearch}
                    onChange={(e) => setSubjectSearch(e.target.value)}
                  />
                </div>
                <div className="staff-assignment-list">
                  {boot.subjects
                    .filter((s) =>
                      (s.name + " " + s.code + " " + classLabel(s.class_id))
                        .toLowerCase()
                        .includes(subjectSearch.toLowerCase()),
                    )
                    .map((s) => {
                      const unavailable =
                        !!s.teacher_id && s.teacher_id !== editing.id;
                      return (
                        <label key={s.id} className="staff-assignment-option">
                          <input
                            type="checkbox"
                            disabled={unavailable}
                            checked={selected.includes(s.id)}
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...ids, s.id]
                                  : ids.filter((id) => id !== s.id),
                              )
                            }
                          />
                          <span>
                            <b>{s.name}</b>
                            <small>
                              {s.code} · {classLabel(s.class_id)} · Sem{" "}
                              {s.semester}
                            </small>
                            {unavailable && (
                              <small>Assigned to {s.teacher}</small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                </div>
                {!boot.subjects.length && (
                  <p className="muted">
                    Create subjects in Academic setup first. You can save the
                    staff profile now and assign subjects later.
                  </p>
                )}
              </fieldset>
            )}
          </Form>
        </Modal>
      )}
      {reset && (
        <Modal title="Reset staff password" close={() => setReset(null)}>
          <p>
            {reset.name} · {reset.employee_code || reset.email}
          </p>
          <p className="muted">
            This signs out all existing sessions. Share the new password
            securely with the staff member.
          </p>
          <Form
            label="Reset password"
            onSubmit={async (b) => {
              await api("/staff/" + reset.id + "/password", {
                method: "POST",
                body: b,
              });
              setReset(null);
              notify("Password reset. All existing sessions were signed out.");
            }}
          >
            <Field
              label="New password (8+ characters)"
              name="password"
              type="password"
              minLength="8"
              maxLength="128"
              autoComplete="new-password"
              required
            />
          </Form>
        </Modal>
      )}
    </>
  );
}

function SettingsPage({ boot, user, revision, refresh, notify, navigate }) {
  const [modal, setModal] = useState(false);
  const auditData = useData(admin(user) ? "/audit" : null, revision, notify),
    students = useData(admin(user) ? "/students" : null, revision, notify);
  return (
    <>
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Your account</h2>
          <p className="muted">
            {user.name} · {roleName(user.role)}
          </p>
          {user.role !== "student" && (
            <p className="muted">
              {[
                boot.user.employee_code,
                boot.user.department,
                boot.user.position,
              ]
                .filter(Boolean)
                .join(" · ") ||
                "Your administrator can complete your employee profile in the Staff directory."}
            </p>
          )}
          <Form
            label="Change password"
            onSubmit={async (b) => {
              await api("/auth/password", { method: "POST", body: b });
              notify("Password updated. Other sessions have been signed out.");
            }}
          >
            <Field
              label="Current password"
              type="password"
              name="current"
              autoComplete="current-password"
              required
            />
            <Field
              label="New password"
              type="password"
              name="password"
              minLength="8"
              maxLength="128"
              autoComplete="new-password"
              required
            />
            <p className="muted">Use at least 8 characters.</p>
          </Form>
        </section>
        {admin(user) && (
          <section className="panel padded">
            <h2>Attendance policy</h2>
            <p className="muted">
              Minimum attendance for reports and low-attendance alerts.
            </p>
            <Form
              onSubmit={async (b) => {
                await api("/settings", { method: "PUT", body: b });
                refresh();
                notify("Attendance threshold updated.");
              }}
            >
              <Field
                label="Required attendance (%)"
                name="threshold"
                type="number"
                min="1"
                max="100"
                step="0.1"
                defaultValue={boot.threshold}
                required
              />
              <div className="policy-list">
                <p>
                  <Check size={16} /> Present and late count as attended.
                </p>
                <p>
                  <Check size={16} /> Blank, draft, and cancelled sessions are
                  excluded.
                </p>
                <p>
                  <Check size={16} /> Leave approval does not grant attendance.
                </p>
              </div>
            </Form>
          </section>
        )}
      </div>
      {admin(user) && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Staff & access</h2>
                <p>
                  Manage employee details and subject assignments in the Staff
                  directory.
                </p>
              </div>
              <div className="button-row">
                <button className="button" onClick={() => navigate("staff")}>
                  Manage staff
                </button>
                <button
                  className="button primary"
                  onClick={() => setModal(true)}
                >
                  <Plus size={16} /> Create student login
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>LOGIN</th>
                    <th>ROLE</th>
                  </tr>
                </thead>
                <tbody>
                  {boot.staff.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.email}</td>
                      <td>
                        <Badge>{roleName(s.role)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel audit-panel">
            <div className="panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>
                  A traceable history of academic and administrative changes
                </p>
              </div>
              <ShieldCheck size={20} />
            </div>
            {auditData?.slice(0, 12).map((a) => (
              <div className="audit-row" key={a.id}>
                <span className="audit-dot" />
                <div>
                  <b>{a.action.replaceAll(".", " · ")}</b>
                  <small>
                    {a.actor || "System migration"} · Record {a.entity}
                  </small>
                </div>
                <time>
                  {new Date(
                    a.created_at.replace(" ", "T") + "Z",
                  ).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            ))}
          </section>
        </>
      )}
      {modal && (
        <Modal title="Create a student login" close={() => setModal(false)}>
          <Form
            label="Create account"
            onSubmit={async (b) => {
              await api("/users", {
                method: "POST",
                body: {
                  ...b,
                  role: "student",
                  student_id: +b.student_id,
                },
              });
              setModal(false);
              refresh();
              notify(
                "Account created. Share the credentials securely with the account holder.",
              );
            }}
          >
            <Field label="Full name" name="name" required />
            <Field label="Email or login ID" name="email" required />
            <Select label="Linked student record" name="student_id" required>
              <option value="">Select a student</option>
              {students?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.campus_id}
                </option>
              ))}
            </Select>
            <Field
              label="Initial password (8+ characters)"
              name="password"
              type="password"
              minLength="8"
              maxLength="128"
              autoComplete="new-password"
              required
            />
          </Form>
        </Modal>
      )}
    </>
  );
}
