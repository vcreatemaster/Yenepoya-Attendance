import express from "express";
import multer from "multer";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  passwordHash,
  passwordMatches,
  transaction,
  audit,
  isAdmin,
  allowedClasses,
  percentages,
  today,
  queueNotification,
} from "./db.js";
import { previewImport, commitImport, template } from "./import.js";
import { registerWorkbook } from "./register-export.js";
import { studentReportRoutes } from "./student-report.js";
import { staffRoutes } from "./staff.js";
import { staffImportRoutes } from "./staff-import.js";

const text = z.string().trim().min(1).max(200),
  id = z.coerce.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const hash = (t) => createHash("sha256").update(t).digest("hex");
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  student_id: u.student_id,
  employee_code: u.employee_code,
  department: u.department,
  position: u.position,
});
const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => {
          let s = String(v ?? "");
          if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");

export function createApp(db) {
  const app = express(),
    attempts = new Map(),
    previews = new Map();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("X-Requested-With") !== "Yenepoya" ||
        (req.get("origin") &&
          new URL(req.get("origin")).host !== req.get("host")))
    )
      return res.status(403).json({ error: "Untrusted request origin" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_, res) => res.json({ ok: true }));
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = z
      .object({ email: text, password: z.string().min(1).max(200) })
      .parse(req.body);
    const key = req.ip,
      now = Date.now();
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (now - v.start > 900000) attempts.delete(k);
    const a = attempts.get(key) || { count: 0, start: now };
    if (now - a.start > 900000) {
      a.count = 0;
      a.start = now;
    }
    if (a.count >= 15)
      fail(429, "Too many login attempts. Try again in 15 minutes.");
    a.count++;
    attempts.set(key, a);
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user || !user.active || !passwordMatches(password, user.password))
      fail(401, "Incorrect login ID or password.");
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM auth_sessions WHERE expires<?").run(now);
    db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(
      hash(token),
      user.id,
      now + 8 * 3600000,
    );
    res
      .cookie("yen_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 3600000,
        path: "/",
      })
      .json({ user: safeUser(user) });
  });
  app.use("/api", (req, res, next) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("yen_session="))
      ?.slice(12);
    const user = raw
      ? db
          .prepare(
            "SELECT u.* FROM users u JOIN auth_sessions a ON a.user_id=u.id WHERE a.token=? AND a.expires>?",
          )
          .get(hash(raw), Date.now())
      : null;
    if (!user || !user.active)
      return res.status(401).json({ error: "Please sign in." });
    req.user = user;
    req.token = raw;
    next();
  });
  const admin = (req, res, next) => {
    if (!isAdmin(req.user)) fail(403, "Administrator access required.");
    next();
  };
  const reviewer = (req, res, next) => {
    if (!isAdmin(req.user) && req.user.role !== "welfare")
      fail(403, "Admin or welfare officer access required.");
    next();
  };
  const classAccess = (req, classId) => {
    if (!allowedClasses(db, req.user).includes(+classId))
      fail(403, "This class is outside your assigned access.");
  };
  const subjectAccess = (req, subjectId, write = false) => {
    const sub = db.prepare("SELECT * FROM subjects WHERE id=?").get(+subjectId);
    if (!sub) fail(404, "Subject not found.");
    classAccess(req, sub.class_id);
    if (req.user.role === "teacher" && sub.teacher_id !== req.user.id)
      fail(403, "You can only access your assigned subjects.");
    if (
      write &&
      !isAdmin(req.user) &&
      !(req.user.role === "teacher" && sub.teacher_id === req.user.id)
    )
      fail(
        403,
        "Only the assigned subject teacher or admin can mark attendance.",
      );
    return sub;
  };
  const staffId = (value, facultyOnly = false) => {
    if (
      value &&
      !db
        .prepare(
          "SELECT id FROM users WHERE id=? AND role<>'student' AND active=1",
        )
        .get(value)
    )
      fail(400, "Select a staff member.");
    if (
      value &&
      facultyOnly &&
      !db
        .prepare(
          "SELECT id FROM users WHERE id=? AND role='teacher' AND active=1",
        )
        .get(value)
    )
      fail(400, "Select an active faculty member as subject teacher.");
    return value || null;
  };
  const visiblePercentages = (user, studentId) => {
    const ownIds =
      user.role === "teacher"
        ? new Set(
            db
              .prepare("SELECT id FROM subjects WHERE teacher_id=?")
              .all(user.id)
              .map((s) => s.id),
          )
        : null;
    return percentages(db, studentId).filter(
      (s) => !ownIds || ownIds.has(s.id),
    );
  };
  staffRoutes(app, db, admin);
  studentReportRoutes(app, db, admin);
  staffImportRoutes(app, db, admin);
  app.get("/api/auth/me", (req, res) => res.json({ user: safeUser(req.user) }));
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM auth_sessions WHERE token=?").run(hash(req.token));
    res.clearCookie("yen_session", { path: "/" }).json({ ok: true });
  });
  app.post("/api/auth/password", (req, res) => {
    const b = z
      .object({
        current: z.string().max(200),
        password: z.string().min(8).max(128),
      })
      .parse(req.body);
    if (!passwordMatches(b.current, req.user.password))
      fail(400, "Current password is incorrect.");
    transaction(db, () => {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        passwordHash(b.password),
        req.user.id,
      );
      db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND token<>?").run(
        req.user.id,
        hash(req.token),
      );
      audit(db, req.user, "password.change", req.user.id, {});
    });
    res.json({ ok: true });
  });
  app.get("/api/bootstrap", (req, res) => {
    const ids = allowedClasses(db, req.user);
    const classes = db
      .prepare(
        "SELECT cl.*,c.code AS course,c.name AS course_name,u.name AS advisor FROM classes cl JOIN courses c ON c.id=cl.course_id LEFT JOIN users u ON u.id=cl.advisor_id ORDER BY c.code,cl.admission_year DESC,cl.section",
      )
      .all()
      .filter((c) => ids.includes(c.id));
    const subjects = db
      .prepare(
        "SELECT s.*,u.name AS teacher FROM subjects s LEFT JOIN users u ON u.id=s.teacher_id ORDER BY s.semester,s.name",
      )
      .all()
      .filter(
        (s) =>
          ids.includes(s.class_id) &&
          (req.user.role !== "teacher" || s.teacher_id === req.user.id),
      );
    res.json({
      user: safeUser(req.user),
      classes,
      subjects,
      courses: db.prepare("SELECT * FROM courses ORDER BY code").all(),
      staff:
        req.user.role === "student"
          ? []
          : db
              .prepare(
                "SELECT id,name,email,role,active FROM users WHERE role<>'student' ORDER BY name",
              )
              .all(),
      threshold: +db
        .prepare("SELECT value FROM settings WHERE key='threshold'")
        .get().value,
      today: today(),
    });
  });
  app.get("/api/students", (req, res) => {
    const ids = allowedClasses(db, req.user),
      sensitive = isAdmin(req.user) || req.user.role === "welfare";
    let students = db
      .prepare(
        `SELECT s.*,c.code AS course,cl.section,cl.admission_year FROM students s JOIN classes cl ON cl.id=s.class_id JOIN courses c ON c.id=cl.course_id ORDER BY s.name`,
      )
      .all()
      .filter((s) => ids.includes(s.class_id));
    if (req.user.role === "student")
      students = students.filter((s) => s.id === req.user.student_id);
    if (req.query.class_id)
      students = students.filter((s) => s.class_id === +req.query.class_id);
    res.json(
      students.map((s) => ({
        ...(sensitive
          ? s
          : {
              id: s.id,
              name: s.name,
              campus_id: s.campus_id,
              registration_number: s.registration_number,
              class_id: s.class_id,
              course: s.course,
              section: s.section,
              admission_year: s.admission_year,
              status: s.status,
            }),
        subjects: visiblePercentages(req.user, s.id),
      })),
    );
  });
  app.post("/api/students/:id/notifications", admin, (req, res) => {
    const b = z
      .object({
        phone: z.string().regex(/^$|^\+[1-9]\d{7,14}$/),
        consent: z.boolean(),
      })
      .parse(req.body);
    if (b.consent && !b.phone)
      fail(400, "A recipient phone is required with consent.");
    const result = db
      .prepare(
        "UPDATE students SET notification_phone=?,whatsapp_consent=? WHERE id=?",
      )
      .run(b.phone, +b.consent, id.parse(req.params.id));
    if (!result.changes) fail(404, "Student not found.");
    audit(db, req.user, "notification.preference", req.params.id, {
      consent: b.consent,
    });
    res.json({ ok: true });
  });
  app.get("/api/attendance", (req, res) => {
    const subject = subjectAccess(req, id.parse(req.query.subject_id));
    const students = db
      .prepare(
        "SELECT id,name,campus_id,registration_number FROM students WHERE class_id=? AND status='active' ORDER BY name",
      )
      .all(subject.class_id)
      .filter(
        (s) => req.user.role !== "student" || s.id === req.user.student_id,
      );
    const sessions = db
      .prepare(
        "SELECT * FROM teaching_sessions WHERE subject_id=? ORDER BY date,period",
      )
      .all(subject.id);
    const marks = db
      .prepare(
        "SELECT m.* FROM marks m JOIN teaching_sessions ts ON ts.id=m.session_id WHERE ts.subject_id=?",
      )
      .all(subject.id)
      .filter((m) => students.some((s) => s.id === m.student_id));
    res.json({ subject, students, sessions, marks });
  });
  app.post("/api/attendance/sessions", (req, res) => {
    const b = z
      .object({
        subject_id: id,
        date,
        period: z.coerce.number().int().min(1).max(20),
      })
      .parse(req.body);
    const subject = subjectAccess(req, b.subject_id, true);
    const holiday = db
      .prepare(
        "SELECT title FROM events WHERE type='holiday' AND date<=? AND end_date>=? AND (class_id IS NULL OR class_id=?)",
      )
      .get(b.date, b.date, subject.class_id);
    if (holiday) fail(400, `This date is a holiday: ${holiday.title}`);
    const result = db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period) VALUES(?,?,?)",
      )
      .run(b.subject_id, b.date, b.period);
    audit(db, req.user, "session.create", result.lastInsertRowid, b);
    res.json({ id: Number(result.lastInsertRowid) });
  });
  app.put("/api/attendance/sessions/:id", (req, res) => {
    const b = z
      .object({
        revision: z.number().int().min(0),
        state: z.enum(["draft", "submitted", "cancelled"]),
        marks: z
          .array(
            z.object({
              student_id: id,
              status: z.enum(["P", "A", "L", "N", ""]),
            }),
          )
          .max(2000),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    transaction(db, () => {
      const session = db
        .prepare("SELECT * FROM teaching_sessions WHERE id=?")
        .get(id.parse(req.params.id));
      if (!session) fail(404, "Session not found.");
      const subject = subjectAccess(req, session.subject_id, true);
      if (session.revision !== b.revision)
        fail(
          409,
          "Another staff member changed this session. Reload attendance before saving.",
        );
      if (
        ["submitted", "imported", "cancelled"].includes(session.state) &&
        (!isAdmin(req.user) || !b.reason)
      )
        fail(
          403,
          "This session is locked. An administrator must provide a correction reason.",
        );
      if (b.state === "submitted" && session.date > today())
        fail(400, "Future sessions cannot be submitted.");
      const studentIds = db
        .prepare("SELECT id FROM students WHERE class_id=? AND status='active'")
        .all(subject.class_id)
        .map((s) => s.id);
      if (
        new Set(b.marks.map((m) => m.student_id)).size !== b.marks.length ||
        b.marks.some((m) => !studentIds.includes(m.student_id))
      )
        fail(400, "Invalid or duplicate student in attendance.");
      if (
        b.state === "submitted" &&
        (!studentIds.length ||
          studentIds.some(
            (s) => !b.marks.some((m) => m.student_id === s && m.status),
          ))
      )
        fail(
          400,
          "Mark every active student before submitting. Use N only for students not enrolled in this session.",
        );
      const before = db
        .prepare("SELECT student_id,status FROM marks WHERE session_id=?")
        .all(session.id);
      db.prepare("DELETE FROM marks WHERE session_id=?").run(session.id);
      for (const m of b.marks)
        if (m.status)
          db.prepare("INSERT INTO marks VALUES(?,?,?)").run(
            session.id,
            m.student_id,
            m.status,
          );
      db.prepare(
        "UPDATE teaching_sessions SET state=?,revision=revision+1 WHERE id=?",
      ).run(b.state, session.id);
      audit(db, req.user, "attendance.save", session.id, {
        before,
        after: b.marks,
        state: b.state,
        reason: b.reason || "",
      });
      // Suppress queued alerts for corrected or retracted attendance. Already-sent messages stay in history.
      db.prepare(
        "UPDATE jobs SET status='cancelled' WHERE status IN ('pending','retry') AND dedupe_key LIKE ?",
      ).run(`absence:${session.id}:%`);
      if (b.state === "submitted")
        for (const m of b.marks)
          if (m.status === "A")
            queueNotification(
              db,
              m.student_id,
              "absence",
              `absence:${session.id}:${m.student_id}:r${session.revision + 1}`,
              {
                message: `Absent from ${subject.name} on ${session.date}, period ${session.period}.`,
                session_id: session.id,
                revision: session.revision + 1,
              },
            );
    });
    res.json({ ok: true });
  });
  app.get("/api/leaves", (req, res) => {
    const ids = allowedClasses(db, req.user);
    res.json(
      db
        .prepare(
          "SELECT l.*,s.name,s.campus_id,s.class_id,c.code AS course,cl.section,u.name AS reviewer FROM leaves l JOIN students s ON s.id=l.student_id JOIN classes cl ON cl.id=s.class_id JOIN courses c ON c.id=cl.course_id LEFT JOIN users u ON u.id=l.reviewed_by ORDER BY l.created_at DESC,l.id DESC",
        )
        .all()
        .filter(
          (l) =>
            ids.includes(l.class_id) &&
            (req.user.role !== "student" ||
              l.student_id === req.user.student_id),
        ),
    );
  });
  app.get("/api/leaves/:id/contacts", reviewer, (req, res) => {
    const contact = db
      .prepare(
        "SELECT s.name,s.campus_id,s.student_phone,s.father_name,s.father_phone,s.mother_name,s.mother_phone,s.guardian_name,s.guardian_phone FROM leaves l JOIN students s ON s.id=l.student_id WHERE l.id=?",
      )
      .get(id.parse(req.params.id));
    if (!contact) fail(404, "Leave request not found.");
    res.json(contact);
  });
  app.post("/api/leaves", (req, res) => {
    if (req.user.role !== "student")
      fail(403, "Only students can request leave.");
    const b = z
      .object({
        from_date: date,
        to_date: date,
        reason: z.string().trim().min(10).max(2000),
        category: z.enum(["personal", "medical", "duty"]),
      })
      .parse(req.body);
    if (b.to_date < b.from_date)
      fail(400, "The end date must be on or after the start date.");
    if ((Date.parse(b.to_date) - Date.parse(b.from_date)) / 86400000 > 90)
      fail(400, "Request up to 90 days at a time.");
    const overlap = db
      .prepare(
        "SELECT id FROM leaves WHERE student_id=? AND status<>'rejected' AND from_date<=? AND to_date>=?",
      )
      .get(req.user.student_id, b.to_date, b.from_date);
    if (overlap)
      fail(
        409,
        "You already have a pending or approved request covering these dates.",
      );
    const r = db
      .prepare(
        "INSERT INTO leaves(student_id,from_date,to_date,category,reason) VALUES(?,?,?,?,?)",
      )
      .run(req.user.student_id, b.from_date, b.to_date, b.category, b.reason);
    audit(db, req.user, "leave.request", r.lastInsertRowid, b);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.post("/api/leaves/:id/review", reviewer, (req, res) => {
    const b = z
      .object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(1000),
      })
      .parse(req.body);
    if (b.status === "rejected" && !b.note)
      fail(400, "Provide a reason for rejection.");
    transaction(db, () => {
      const leave = db
        .prepare("SELECT * FROM leaves WHERE id=?")
        .get(id.parse(req.params.id));
      if (!leave) fail(404, "Leave request not found.");
      if (leave.status !== "pending")
        fail(409, "This request has already been reviewed.");
      db.prepare(
        "UPDATE leaves SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(b.status, b.note, req.user.id, leave.id);
      audit(db, req.user, "leave.review", leave.id, b);
      queueNotification(db, leave.student_id, "leave", `leave:${leave.id}`, {
        message: `Your leave request for ${leave.from_date} to ${leave.to_date} was ${b.status}. ${b.note}`,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/calendar", (req, res) => {
    const ids = allowedClasses(db, req.user);
    res.json(
      db
        .prepare(
          "SELECT e.*,c.code AS course,cl.section FROM events e LEFT JOIN classes cl ON cl.id=e.class_id LEFT JOIN courses c ON c.id=cl.course_id ORDER BY date",
        )
        .all()
        .filter((e) => !e.class_id || ids.includes(e.class_id)),
    );
  });
  app.post("/api/calendar", admin, (req, res) => {
    const b = z
      .object({
        title: text,
        date,
        end_date: date,
        type: z.enum(["holiday", "exam", "academic", "event"]),
        class_id: id.nullable(),
        description: z.string().max(2000).default(""),
      })
      .parse(req.body);
    if (b.end_date < b.date) fail(400, "Invalid date range.");
    const r = db
      .prepare(
        "INSERT INTO events(title,date,end_date,type,class_id,description) VALUES(?,?,?,?,?,?)",
      )
      .run(b.title, b.date, b.end_date, b.type, b.class_id, b.description);
    audit(db, req.user, "calendar.create", r.lastInsertRowid, b);
    res.json({ ok: true });
  });
  app.delete("/api/calendar/:id", admin, (req, res) => {
    db.prepare("DELETE FROM events WHERE id=?").run(id.parse(req.params.id));
    audit(db, req.user, "calendar.delete", req.params.id, {});
    res.json({ ok: true });
  });
  app.post("/api/courses", admin, (req, res) => {
    const b = z.object({ code: text, name: text }).parse(req.body);
    const r = db
      .prepare("INSERT INTO courses(code,name) VALUES(?,?)")
      .run(b.code.toUpperCase(), b.name);
    audit(db, req.user, "course.create", r.lastInsertRowid, b);
    res.json({ ok: true });
  });
  app.post("/api/classes", admin, (req, res) => {
    const b = z
      .object({
        course_id: id,
        admission_year: z.coerce.number().int().min(2000).max(2100),
        section: text,
        semester: z.coerce.number().int().min(1).max(12),
        advisor_id: id.nullable(),
      })
      .parse(req.body);
    const r = db
      .prepare(
        "INSERT INTO classes(course_id,admission_year,section,semester,advisor_id) VALUES(?,?,?,?,?)",
      )
      .run(
        b.course_id,
        b.admission_year,
        b.section.toUpperCase(),
        b.semester,
        staffId(b.advisor_id),
      );
    audit(db, req.user, "class.create", r.lastInsertRowid, b);
    res.json({ ok: true });
  });
  app.patch("/api/classes/:id", admin, (req, res) => {
    const b = z
      .object({
        advisor_id: id.nullable(),
        semester: z.coerce.number().int().min(1).max(12),
      })
      .parse(req.body);
    db.prepare("UPDATE classes SET advisor_id=?,semester=? WHERE id=?").run(
      staffId(b.advisor_id),
      b.semester,
      id.parse(req.params.id),
    );
    audit(db, req.user, "class.update", req.params.id, b);
    res.json({ ok: true });
  });
  app.post("/api/subjects", admin, (req, res) => {
    const b = z
      .object({
        class_id: id,
        name: text,
        code: text,
        semester: z.coerce.number().int().min(1).max(12),
        teacher_id: id.nullable(),
      })
      .parse(req.body);
    const r = db
      .prepare(
        "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(?,?,?,?,?)",
      )
      .run(
        b.class_id,
        b.name,
        b.code.toUpperCase(),
        b.semester,
        staffId(b.teacher_id, true),
      );
    db.prepare(
      "UPDATE users SET staff_revision=staff_revision+1 WHERE role<>'student'",
    ).run();
    audit(db, req.user, "subject.create", r.lastInsertRowid, b);
    res.json({ ok: true });
  });
  app.patch("/api/subjects/:id", admin, (req, res) => {
    const b = z.object({ teacher_id: id.nullable() }).parse(req.body);
    db.prepare("UPDATE subjects SET teacher_id=? WHERE id=?").run(
      staffId(b.teacher_id, true),
      id.parse(req.params.id),
    );
    db.prepare(
      "UPDATE users SET staff_revision=staff_revision+1 WHERE role<>'student'",
    ).run();
    audit(db, req.user, "subject.assign", req.params.id, b);
    res.json({ ok: true });
  });
  app.post("/api/users", admin, (req, res) => {
    const b = z
      .object({
        name: text,
        email: text,
        password: z.string().min(8).max(128),
        role: z.enum(["admin", "welfare", "teacher", "student"]),
        student_id: id.nullable(),
      })
      .parse(req.body);
    if (b.role === "admin" && req.user.role !== "master_admin")
      fail(403, "Only the master admin can create administrators.");
    if (b.role === "student" && !b.student_id)
      fail(400, "Select a student record.");
    if (b.role !== "student" && b.student_id)
      fail(400, "Staff accounts cannot link to a student record.");
    const r = db
      .prepare(
        "INSERT INTO users(name,email,password,role,student_id) VALUES(?,?,?,?,?)",
      )
      .run(b.name, b.email, passwordHash(b.password), b.role, b.student_id);
    audit(db, req.user, "user.create", r.lastInsertRowid, { role: b.role });
    res.json({ ok: true });
  });
  app.put("/api/settings", admin, (req, res) => {
    const b = z
      .object({ threshold: z.coerce.number().min(1).max(100) })
      .parse(req.body);
    db.prepare("UPDATE settings SET value=? WHERE key='threshold'").run(
      String(b.threshold),
    );
    audit(db, req.user, "settings.update", "settings", b);
    res.json({ ok: true });
  });
  app.get("/api/import/template", admin, async (req, res) => {
    res
      .attachment("student-import-template.xlsx")
      .send(Buffer.from(await template()));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/import/preview",
    admin,
    upload.single("file"),
    async (req, res) => {
      if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
        fail(400, "Upload an .xlsx workbook.");
      for (const [key, v] of previews)
        if (v.expires < Date.now()) previews.delete(key);
      if (previews.size >= 20)
        fail(429, "Too many pending imports. Wait 15 minutes.");
      let rows;
      try {
        rows = await previewImport(req.file.buffer, db);
      } catch (e) {
        fail(400, e.message);
      }
      const token = randomBytes(20).toString("hex");
      previews.set(token, {
        user: req.user.id,
        rows,
        expires: Date.now() + 900000,
      });
      res.json({ token, rows, valid: rows.every((r) => !r.errors.length) });
    },
  );
  app.post("/api/import/commit", admin, (req, res) => {
    const token = text.parse(req.body.token),
      p = previews.get(token);
    if (!p || p.user !== req.user.id || p.expires < Date.now())
      fail(400, "Preview expired. Upload the workbook again.");
    if (p.rows.some((r) => r.errors.length))
      fail(400, "Fix all import errors before importing.");
    const result = commitImport(p.rows, db, req.user);
    previews.delete(token);
    res.json(result);
  });
  app.get("/api/reports/export", (req, res) => {
    if (req.user.role === "student") fail(403, "Staff access required.");
    const ids = allowedClasses(db, req.user),
      rows = [
        [
          "Campus ID",
          "Student",
          "Course",
          "Admission year",
          "Section",
          "Subject",
          "Attended",
          "Recorded sessions",
          "Percentage",
        ],
      ];
    for (const s of db
      .prepare(
        "SELECT s.*,c.code,cl.admission_year,cl.section FROM students s JOIN classes cl ON cl.id=s.class_id JOIN courses c ON c.id=cl.course_id",
      )
      .all()
      .filter(
        (s) =>
          ids.includes(s.class_id) &&
          (!req.query.class_id || s.class_id === +req.query.class_id),
      ))
      for (const p of visiblePercentages(req.user, s.id))
        rows.push([
          s.campus_id,
          s.name,
          s.code,
          s.admission_year,
          s.section,
          p.name,
          p.attended,
          p.total,
          p.percentage,
        ]);
    res
      .type("text/csv")
      .attachment("attendance-report.csv")
      .send("\uFEFF" + csv(rows));
  });
  app.get("/api/attendance/export", async (req, res) => {
    if (req.user.role === "student") fail(403, "Staff access required.");
    const sub = subjectAccess(req, id.parse(req.query.subject_id));
    const month =
      req.query.month === undefined
        ? undefined
        : z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .parse(req.query.month);
    const buffer = await registerWorkbook(db, sub, month);
    res
      .attachment(
        `attendance-register-${sub.id}${month ? "-" + month : ""}.xlsx`,
      )
      .send(Buffer.from(buffer));
  });
  app.get("/api/audit", admin, (_, res) =>
    res.json(
      db
        .prepare(
          "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.get("/api/notifications", admin, (_, res) =>
    res.json({
      mode: process.env.WHATSAPP_MODE || "dry-run",
      jobs: db
        .prepare(
          "SELECT j.id,j.kind,j.status,j.attempts,j.last_error,j.created_at,s.name FROM jobs j LEFT JOIN students s ON s.id=j.student_id ORDER BY j.id DESC LIMIT 100",
        )
        .all(),
    }),
  );
  app.post("/api/notifications/summary", admin, (req, res) => {
    transaction(db, () => {
      const threshold = +db
        .prepare("SELECT value FROM settings WHERE key='threshold'")
        .get().value;
      for (const s of db
        .prepare(
          "SELECT id FROM students WHERE status='active' AND whatsapp_consent=1",
        )
        .all()) {
        const low = percentages(db, s.id).filter(
          (p) => p.percentage !== null && p.percentage < threshold,
        );
        if (low.length)
          queueNotification(
            db,
            s.id,
            "low_attendance",
            `summary:${today()}:${s.id}`,
            {
              message: `Attendance below ${threshold}%: ${low.map((p) => `${p.code} ${p.percentage}%`).join(", ")}.`,
            },
          );
      }
      audit(db, req.user, "notifications.summary", today(), {});
    });
    res.json({ ok: true });
  });
  app.use("/api", (_, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  if (existsSync(resolve("dist/index.html"))) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (_, res) => res.sendFile(resolve("dist/index.html")));
  }
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (err.code === "LIMIT_FILE_SIZE")
      return res
        .status(413)
        .json({ error: "The workbook must be under 8 MB." });
    if (/UNIQUE constraint/.test(err.message))
      return res.status(409).json({
        error:
          "This record already exists. Check the employee code, campus ID, login ID, or session date and period.",
      });
    if (/FOREIGN KEY constraint/.test(err.message))
      return res.status(400).json({
        error: "A referenced record no longer exists. Refresh and try again.",
      });
    if (!err.status) console.error(err.message);
    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : "Unable to complete the request. Please try again.",
    });
  });
  return app;
}
