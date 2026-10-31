import { z } from "zod";
import { createHash } from "node:crypto";
import {
  allowedClasses,
  isAdmin,
  percentages,
  transaction,
  audit,
  today,
} from "./db.js";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const version = (s) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
const id = z.coerce.number().int().positive();
const text = z.string().trim().max(200);
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || /^\+?[\d\s()\-]{6,30}$/.test(v), "Invalid phone number");
const schema = z.object({
  revision: z.string(),
  name: text.min(1),
  campus_id: text.min(1),
  registration_number: text,
  blood_group: text.max(20),
  father_name: text,
  father_phone: phone,
  mother_name: text,
  mother_phone: phone,
  guardian_name: text,
  guardian_phone: phone,
  student_phone: phone,
  address: z.string().trim().max(2000),
  class_id: id,
  status: z.enum(["active", "inactive"]),
});
export function studentReportRoutes(app, db, admin) {
  app.get("/api/students/:id/report", (req, res) => {
    const s = db
      .prepare("SELECT * FROM students WHERE id=?")
      .get(id.parse(req.params.id));
    if (!s) fail(404, "Student not found.");
    if (
      req.user.role === "student" ||
      !allowedClasses(db, req.user).includes(s.class_id)
    )
      fail(403, "Student report access denied.");
    const sensitive = isAdmin(req.user) || req.user.role === "welfare";
    const cls = db
      .prepare(
        "SELECT cl.*,c.code AS course,u.name AS advisor FROM classes cl JOIN courses c ON c.id=cl.course_id LEFT JOIN users u ON u.id=cl.advisor_id WHERE cl.id=?",
      )
      .get(s.class_id);
    const subjects = percentages(db, s.id).filter(
      (sub) =>
        req.user.role !== "teacher" ||
        db.prepare("SELECT teacher_id FROM subjects WHERE id=?").get(sub.id)
          ?.teacher_id === req.user.id,
    );
    const history = db
      .prepare(
        `SELECT ts.id,ts.date,ts.period,ts.state,sub.id AS subject_id,sub.name AS subject,sub.code,sub.class_id,sub.teacher_id,m.status FROM teaching_sessions ts JOIN subjects sub ON sub.id=ts.subject_id LEFT JOIN marks m ON m.session_id=ts.id AND m.student_id=? WHERE sub.class_id=? OR m.student_id=? ORDER BY ts.date DESC,ts.period DESC,sub.name`,
      )
      .all(s.id, s.class_id, s.id)
      .filter(
        (r) => req.user.role !== "teacher" || r.teacher_id === req.user.id,
      )
      .map((r) => ({
        ...r,
        counted:
          ["submitted", "imported"].includes(r.state) &&
          r.date <= today() &&
          ["P", "A", "L"].includes(r.status),
      }));
    const leaves = sensitive
      ? db
          .prepare(
            "SELECT l.*,u.name AS reviewer FROM leaves l LEFT JOIN users u ON u.id=l.reviewed_by WHERE l.student_id=? ORDER BY l.from_date DESC,l.id DESC",
          )
          .all(s.id)
      : [];
    const days = new Set();
    for (const l of leaves.filter((l) => l.status === "approved")) {
      const end = new Date(l.to_date + "T00:00:00Z");
      for (
        let date = new Date(l.from_date + "T00:00:00Z");
        date <= end;
        date.setUTCDate(date.getUTCDate() + 1)
      )
        days.add(date.toISOString().slice(0, 10));
    }
    res.json({
      student: sensitive
        ? s
        : {
            id: s.id,
            name: s.name,
            campus_id: s.campus_id,
            registration_number: s.registration_number,
            class_id: s.class_id,
            status: s.status,
          },
      revision: isAdmin(req.user) ? version(s) : undefined,
      class: cls,
      subjects,
      history,
      leaves,
      can_view_leaves: sensitive,
      approved_leave_days: days.size,
    });
  });
  app.patch("/api/students/:id", admin, (req, res) => {
    const studentId = id.parse(req.params.id),
      b = schema.parse(req.body);
    transaction(db, () => {
      const old = db
        .prepare("SELECT * FROM students WHERE id=?")
        .get(studentId);
      if (!old) fail(404, "Student not found.");
      if (version(old) !== b.revision)
        fail(409, "Student details changed. Reopen the report before editing.");
      if (!db.prepare("SELECT id FROM classes WHERE id=?").get(b.class_id))
        fail(400, "Choose an existing class.");
      if (
        old.class_id !== b.class_id &&
        db
          .prepare("SELECT 1 FROM marks WHERE student_id=? LIMIT 1")
          .get(studentId)
      )
        fail(
          400,
          "This student has attendance records. Class transfers require a separate migration; the existing class must be retained.",
        );
      if (
        db
          .prepare("SELECT id FROM students WHERE campus_id=? AND id<>?")
          .get(b.campus_id, studentId)
      )
        fail(409, "Campus ID already belongs to another student.");
      const { revision, ...fields } = b;
      db.prepare(
        `UPDATE students SET ${Object.keys(fields)
          .map((k) => `${k}=?`)
          .join(",")} WHERE id=?`,
      ).run(...Object.values(fields), studentId);
      if (old.name !== b.name)
        db.prepare(
          "UPDATE users SET name=? WHERE student_id=? AND role='student'",
        ).run(b.name, studentId);
      audit(db, req.user, "student.update", studentId, {
        changed_fields: Object.keys(fields).filter((k) => fields[k] !== old[k]),
      });
    });
    res.json({ ok: true });
  });
}
