import ExcelJS from "exceljs";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { passwordHash, transaction, audit } from "./db.js";
const fields = [
  "employee_code",
  "name",
  "email",
  "department",
  "position",
  "role",
  "password",
  "subject_ids",
];
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export async function previewStaff(buffer, db, user) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount > 251 || sheet.columnCount > 30)
    fail("Use at most 250 staff rows and 30 columns.");
  const headers = [];
  sheet.getRow(1).eachCell((cell, i) => {
    const h = cell.text.trim().toLowerCase().replaceAll(" ", "_");
    headers[i] =
      {
        emp_code: "employee_code",
        dept: "department",
        subjects: "subject_ids",
      }[h] || h;
  });
  for (const field of fields.slice(0, 7))
    if (!headers.includes(field)) fail(`Missing header: ${field}`);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    fail("Duplicate headers are not allowed.");
  const rows = [],
    emails = new Set(),
    codes = new Set(),
    assigned = new Set();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const data = Object.fromEntries(fields.map((f) => [f, ""]));
    const errors = [];
    row.eachCell((cell, i) => {
      if (!fields.includes(headers[i])) return;
      if (
        cell.type === ExcelJS.ValueType.Formula ||
        cell.type === ExcelJS.ValueType.Error
      )
        errors.push("Use plain values, not formulas or Excel errors.");
      data[headers[i]] =
        headers[i] === "password" ? cell.text : cell.text.trim();
    });
    if (Object.values(data).every((v) => !v)) return;
    for (const f of fields.slice(0, 7))
      if (!data[f]) errors.push(`${f} is required`);
    for (const f of ["name", "email", "department", "position"])
      if (data[f].length > 200) errors.push(`${f} is too long`);
    if (data.employee_code.length > 40)
      errors.push("Employee code is too long");
    data.employee_code = data.employee_code.toUpperCase();
    data.email = data.email.toLowerCase();
    data.role = data.role.toLowerCase();
    if (!z.email().safeParse(data.email).success) errors.push("Invalid email");
    if (!["teacher", "welfare", "admin"].includes(data.role))
      errors.push("Role must be teacher, welfare or admin");
    if (data.role === "admin" && user.role !== "master_admin")
      errors.push("Only the master administrator can import admins");
    if (data.password.length < 8 || data.password.length > 128)
      errors.push("Password must contain 8–128 characters");
    if (emails.has(data.email)) errors.push("Duplicate email in workbook");
    if (codes.has(data.employee_code))
      errors.push("Duplicate employee code in workbook");
    emails.add(data.email);
    codes.add(data.employee_code);
    if (
      db
        .prepare("SELECT id FROM users WHERE email=? OR employee_code=?")
        .get(data.email, data.employee_code)
    )
      errors.push(
        "Email or employee code already exists; edit existing staff separately",
      );
    const ids = data.subject_ids
      ? data.subject_ids.split(/[,;]/).map((v) => Number(v.trim()))
      : [];
    if (
      ids.length > 300 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length
    )
      errors.push(
        "Subject IDs must be unique positive numbers, separated by commas",
      );
    if (ids.length && data.role !== "teacher")
      errors.push("Only teachers can be assigned subjects");
    for (const id of ids) {
      const subject = Number.isSafeInteger(id)
        ? db.prepare("SELECT teacher_id FROM subjects WHERE id=?").get(id)
        : null;
      if (!subject) errors.push(`Unknown subject ID: ${id}`);
      else if (subject.teacher_id)
        errors.push(`Subject ${id} already has a teacher`);
      if (assigned.has(id))
        errors.push(`Subject ${id} appears for multiple staff`);
      assigned.add(id);
    }
    const { password, ...safe } = data;
    rows.push({
      row: index,
      data: { ...safe, subject_ids: ids },
      errors,
      password_hash: errors.length ? null : passwordHash(password),
    });
  });
  if (!rows.length) fail("The workbook contains no staff rows.");
  return rows;
}
export function commitStaff(rows, db, user) {
  if (!rows.length || rows.some((r) => r.errors.length || !r.password_hash))
    fail("Fix all errors before importing.");
  return transaction(db, () => {
    for (const { data: d, password_hash } of rows) {
      if (d.role === "admin" && user.role !== "master_admin")
        fail("Only the master administrator can import admins", 403);
      if (
        db
          .prepare("SELECT id FROM users WHERE email=? OR employee_code=?")
          .get(d.email, d.employee_code)
      )
        fail("Staff records changed. Upload the workbook again.", 409);
      for (const id of d.subject_ids) {
        const s = db
          .prepare("SELECT teacher_id FROM subjects WHERE id=?")
          .get(id);
        if (!s || s.teacher_id)
          fail("Subject assignments changed. Upload the workbook again.", 409);
      }
      const r = db
        .prepare(
          "INSERT INTO users(name,email,password,role,employee_code,department,position) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          d.name,
          d.email,
          password_hash,
          d.role,
          d.employee_code,
          d.department,
          d.position,
        );
      for (const id of d.subject_ids)
        db.prepare("UPDATE subjects SET teacher_id=? WHERE id=?").run(
          r.lastInsertRowid,
          id,
        );
    }
    audit(db, user, "staff.import", "staff", { created: rows.length });
    return { created: rows.length };
  });
}
export function staffImportRoutes(app, db, admin) {
  const previews = new Map();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  });
  app.get("/api/staff/import/template", admin, async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Staff");
    s.addRow(fields);
    s.getRow(1).font = { bold: true };
    s.views = [{ state: "frozen", ySplit: 1 }];
    fields.forEach((f, i) => {
      s.getColumn(i + 1).width = f === "subject_ids" ? 30 : 25;
      s.getColumn(i + 1).numFmt = "@";
    });
    const help = wb.addWorksheet("Instructions");
    [
      "Fill the Staff sheet, one new staff member per row (maximum 250).",
      "Required: employee_code, name, email, department, position, role, password.",
      "Roles: teacher, welfare, admin. Only master admin can import admins.",
      "Passwords: 8–128 characters; enter literal text. Passwords are not shown in previews.",
      "Optional subject_ids: comma-separated IDs from Subjects sheet. Only teachers can own subjects.",
      "Existing accounts are not overwritten. Assignments to existing teachers cannot be replaced.",
      "Use plain values; formulas are not accepted.",
    ].forEach((t) => help.addRow([t]));
    help.getColumn(1).width = 110;
    const subjects = wb.addWorksheet("Subjects");
    subjects.addRow([
      "ID",
      "Subject",
      "Code",
      "Course",
      "Admission year",
      "Batch",
      "Semester",
      "Current teacher",
    ]);
    for (const r of db
      .prepare(
        "SELECT s.id,s.name,s.code,c.code AS course,cl.admission_year,cl.section,s.semester,u.name AS teacher FROM subjects s JOIN classes cl ON cl.id=s.class_id JOIN courses c ON c.id=cl.course_id LEFT JOIN users u ON u.id=s.teacher_id ORDER BY s.id",
      )
      .all())
      subjects.addRow([
        r.id,
        r.name,
        r.code,
        r.course,
        r.admission_year,
        r.section,
        r.semester,
        r.teacher || "Unassigned",
      ]);
    subjects.columns.forEach((c) => (c.width = 24));
    res
      .attachment("staff-import-template.xlsx")
      .send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  app.post(
    "/api/staff/import/preview",
    admin,
    upload.single("file"),
    async (req, res) => {
      for (const [key, p] of previews)
        if (p.expires < Date.now()) previews.delete(key);
      if (previews.size >= 20)
        fail("Too many previews. Try again in 15 minutes.", 429);
      if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
        fail("Upload an .xlsx workbook.");
      let rows;
      try {
        rows = await previewStaff(req.file.buffer, db, req.user);
      } catch (e) {
        fail(e.message);
      }
      const token = randomBytes(24).toString("hex");
      previews.set(token, {
        rows,
        user: req.user.id,
        expires: Date.now() + 900000,
      });
      res.json({
        token,
        valid: rows.every((r) => !r.errors.length),
        rows: rows.map(({ password_hash, ...row }) => row),
      });
    },
  );
  app.post("/api/staff/import/commit", admin, (req, res) => {
    const p = previews.get(req.body.token);
    if (!p || p.user !== req.user.id || p.expires < Date.now())
      fail("Preview expired. Upload the workbook again.");
    const result = commitStaff(p.rows, db, req.user);
    previews.delete(req.body.token);
    res.json(result);
  });
}
