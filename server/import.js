import ExcelJS from "exceljs";
import { transaction, audit } from "./db.js";

export const importFields = [
  "name",
  "course",
  "admission_year",
  "batch",
  "campus_id",
  "registration_number",
  "blood_group",
  "father_name",
  "father_phone",
  "mother_name",
  "mother_phone",
  "guardian_name",
  "guardian_phone",
  "student_phone",
  "address",
];
const aliases = {
  "campus id": "campus_id",
  "reg number": "registration_number",
  "registration number": "registration_number",
  "admission year": "admission_year",
  "blood group": "blood_group",
  "father name": "father_name",
  "father phone": "father_phone",
  "mother name": "mother_name",
  "mother phone": "mother_phone",
  "guardian name": "guardian_name",
  "guardian phone": "guardian_phone",
  "student phone": "student_phone",
  section: "batch",
};
const value = (cell) => String(cell.text || "").trim();
export async function previewImport(buffer, db) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("The workbook has no worksheets.");
  if (sheet.rowCount > 10001 || sheet.columnCount > 100)
    throw new Error("Use at most 10,000 students and 100 columns per import.");
  const headers = [];
  sheet.getRow(1).eachCell((cell, i) => {
    const h = value(cell).toLowerCase();
    headers[i] = aliases[h] || h.replaceAll(" ", "_");
  });
  const required = ["name", "course", "admission_year", "batch", "campus_id"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length)
    throw new Error(
      `Missing headers: ${missing.join(", ")}. Use the student import template; the attendance tracker has a different layout.`,
    );
  const seen = new Set(),
    rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const data = Object.fromEntries(importFields.map((k) => [k, ""]));
    row.eachCell((cell, i) => {
      if (importFields.includes(headers[i])) data[headers[i]] = value(cell);
    });
    if (Object.values(data).every((v) => !v)) return;
    const errors = [];
    for (const k of required) if (!data[k]) errors.push(`${k} is required`);
    if (
      !/^\d{4}$/.test(data.admission_year) ||
      +data.admission_year < 2000 ||
      +data.admission_year > 2100
    )
      errors.push("Invalid admission year");
    if (Object.values(data).some((v) => v.length > 1000))
      errors.push("A field exceeds 1,000 characters");
    for (const k of [
      "father_phone",
      "mother_phone",
      "guardian_phone",
      "student_phone",
    ])
      if (data[k] && !/^\+?[\d ()-]{7,20}$/.test(data[k]))
        errors.push(`${k} is invalid`);
    if (seen.has(data.campus_id))
      errors.push("Duplicate campus ID in workbook");
    seen.add(data.campus_id);
    const cls = db
      .prepare(
        "SELECT cl.id FROM classes cl JOIN courses c ON c.id=cl.course_id WHERE c.code=? COLLATE NOCASE AND cl.admission_year=? AND cl.section=? COLLATE NOCASE",
      )
      .get(data.course, +data.admission_year, data.batch);
    if (!cls)
      errors.push(
        "Course / admission year / batch does not exist. Create it in Academic setup first.",
      );
    const existing = db
      .prepare("SELECT id,class_id FROM students WHERE campus_id=?")
      .get(data.campus_id);
    if (existing && existing.class_id !== cls?.id)
      errors.push(
        "Class transfer requires separate review; bulk import cannot move an existing student.",
      );
    rows.push({
      row: index,
      data,
      class_id: cls?.id,
      action: existing ? "update" : "create",
      errors,
    });
  });
  if (!rows.length) throw new Error("No student rows found.");
  return rows;
}
export function commitImport(rows, db, user) {
  return transaction(db, () => {
    for (const { data, class_id } of rows) {
      const keys = importFields.filter(
        (k) => !["course", "admission_year", "batch"].includes(k),
      );
      db.prepare(
        `INSERT INTO students(${keys.join(",")},class_id) VALUES(${keys.map(() => "?").join(",")},?) ON CONFLICT(campus_id) DO UPDATE SET ${keys
          .filter((k) => k !== "campus_id")
          .map((k) => `${k}=excluded.${k}`)
          .join(",")}`,
      ).run(...keys.map((k) => data[k]), class_id);
    }
    audit(db, user, "students.import", "students", { count: rows.length });
    return { count: rows.length };
  });
}
export async function template() {
  const wb = new ExcelJS.Workbook(),
    s = wb.addWorksheet("Students");
  s.addRow(importFields);
  s.getRow(1).font = { bold: true };
  s.addRow([
    "Example Student",
    "BCA",
    "2026",
    "A",
    "EXAMPLE-001",
    "",
    "O+",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  s.columns.forEach((c) => {
    c.width = 23;
    c.numFmt = "@";
  });
  s.views = [{ state: "frozen", ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}
