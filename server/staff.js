import { z } from "zod";
import { audit, transaction, passwordHash } from "./db.js";

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = z.string().trim().min(1).max(200);
const profile = z.object({
  name: text,
  email: text,
  employee_code: z.string().trim().min(1).max(40),
  department: text,
  position: text,
  active: z.boolean(),
  subject_ids: z
    .array(z.number().int().positive())
    .max(300)
    .refine(
      (v) => new Set(v).size === v.length,
      "Duplicate subject assignment",
    ),
});
export function staffRoutes(app, db, admin) {
  const editable = (req, staffId) => {
    const staff = db
      .prepare("SELECT * FROM users WHERE id=? AND role<>'student'")
      .get(staffId);
    if (!staff) fail(404, "Staff member not found.");
    if (
      staff.role === "master_admin" ||
      (staff.role === "admin" && req.user.role !== "master_admin")
    )
      fail(403, "This account cannot be managed with your access.");
    return staff;
  };
  const assign = (userId, role, subjectIds) => {
    if (subjectIds.length && role !== "teacher")
      fail(400, "Subject assignments require the faculty role.");
    for (const sid of subjectIds) {
      const subject = db
        .prepare("SELECT id,teacher_id FROM subjects WHERE id=?")
        .get(sid);
      if (!subject) fail(400, "A selected subject no longer exists.");
      if (subject.teacher_id && subject.teacher_id !== userId)
        fail(
          409,
          "A subject belongs to another staff member. Reassign it in Academic setup first.",
        );
    }
    db.prepare("UPDATE subjects SET teacher_id=NULL WHERE teacher_id=?").run(
      userId,
    );
    for (const sid of subjectIds)
      db.prepare("UPDATE subjects SET teacher_id=? WHERE id=?").run(
        userId,
        sid,
      );
  };
  app.get("/api/staff", admin, (_, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,email,role,employee_code,department,position,active,staff_revision FROM users WHERE role<>'student' ORDER BY name",
        )
        .all()
        .map((u) => ({
          ...u,
          subjects: db
            .prepare(
              `SELECT s.id,s.name,s.code,s.semester,c.code AS course,cl.section,cl.admission_year FROM subjects s JOIN classes cl ON cl.id=s.class_id JOIN courses c ON c.id=cl.course_id WHERE s.teacher_id=? ORDER BY c.code,cl.section,s.name`,
            )
            .all(u.id),
        })),
    ),
  );
  app.post("/api/staff", admin, (req, res) => {
    const b = profile
      .extend({
        role: z.enum(["teacher", "welfare", "admin"]),
        password: z.string().min(8).max(128),
      })
      .parse(req.body);
    if (b.role === "admin" && req.user.role !== "master_admin")
      fail(403, "Only the master administrator can create administrators.");
    const userId = transaction(db, () => {
      const result = db
        .prepare(
          "INSERT INTO users(name,email,password,role,employee_code,department,position,active) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          b.name,
          b.email,
          passwordHash(b.password),
          b.role,
          b.employee_code.toUpperCase(),
          b.department,
          b.position,
          +b.active,
        );
      const id = Number(result.lastInsertRowid);
      assign(id, b.role, b.subject_ids);
      audit(db, req.user, "staff.create", id, {
        employee_code: b.employee_code,
        role: b.role,
        subject_ids: b.subject_ids,
      });
      return id;
    });
    res.status(201).json({ id: userId });
  });
  app.patch("/api/staff/:id", admin, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = profile
      .extend({ revision: z.number().int().nonnegative() })
      .parse(req.body);
    transaction(db, () => {
      const staff = editable(req, id);
      if (staff.staff_revision !== b.revision)
        fail(
          409,
          "Staff details or assignments changed. Reload the staff directory before editing.",
        );
      assign(id, staff.role, b.subject_ids);
      db.prepare(
        "UPDATE users SET name=?,email=?,employee_code=?,department=?,position=?,active=?,staff_revision=staff_revision+1 WHERE id=?",
      ).run(
        b.name,
        b.email,
        b.employee_code.toUpperCase(),
        b.department,
        b.position,
        +b.active,
        id,
      );
      if (!b.active)
        db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(id);
      audit(db, req.user, "staff.update", id, {
        ...b,
        previous_active: !!staff.active,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/staff/:id/password", admin, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = z
      .object({ password: z.string().min(8).max(128) })
      .parse(req.body);
    transaction(db, () => {
      editable(req, id);
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        passwordHash(b.password),
        id,
      );
      db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(id);
      audit(db, req.user, "staff.password_reset", id, {});
    });
    res.json({ ok: true });
  });
}
