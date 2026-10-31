import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { openDatabase, passwordHash, transaction, audit } from "./db.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = openDatabase();
if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n) {
  console.log("Already initialized; no records changed.");
  db.close();
  process.exit(0);
}
const workbookPath = process.argv[2];
let wb;
if (workbookPath) {
  wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  if (wb.worksheets[0].getCell("B15").text !== "Campus Id")
    throw new Error("Expected the supplied attendance tracker layout.");
}
const credentials = [];
const addUser = (name, email, role, studentId = null) => {
  const password = randomBytes(15).toString("base64url");
  const r = db
    .prepare(
      "INSERT INTO users(name,email,password,role,student_id) VALUES(?,?,?,?,?)",
    )
    .run(name, email, passwordHash(password), role, studentId);
  credentials.push({ name, login: email, password, role });
  return Number(r.lastInsertRowid);
};
transaction(db, () => {
  addUser("Master Administrator", "admin@yenepoya.local", "master_admin");
  const teacher = addUser(
    "Karunya Thomas",
    "teacher@yenepoya.local",
    "teacher",
  );
  addUser("Student Welfare Officer", "welfare@yenepoya.local", "welfare");
  db.prepare("INSERT INTO courses(code,name) VALUES(?,?)").run(
    "BCA",
    "Bachelor of Computer Applications",
  );
  db.prepare("INSERT INTO courses(code,name) VALUES(?,?)").run(
    "BBA",
    "Bachelor of Business Administration",
  );
  db.prepare(
    "INSERT INTO classes(course_id,admission_year,section,semester,advisor_id) VALUES(1,2026,'A',1,?)",
  ).run(teacher);
  db.prepare(
    "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(1,?,?,1,?)",
  ).run("Digital Logic and Computer Organization", "DLCO", teacher);
  if (wb) {
    const sheet = wb.worksheets[0],
      students = [];
    for (let row = 17; row <= 75; row++) {
      const name = sheet.getCell(`D${row}`).text.trim(),
        campus = sheet.getCell(`B${row}`).text.trim();
      if (!name || !campus) continue;
      const r = db
        .prepare(
          "INSERT INTO students(campus_id,registration_number,name,class_id) VALUES(?,?,?,1)",
        )
        .run(campus, sheet.getCell(`C${row}`).text.trim(), name);
      students.push({ id: Number(r.lastInsertRowid), row });
    }
    const periods = {};
    let imported = 0,
      empty = 0,
      blanks = 0;
    const normalized = [],
      needsReview = [];
    for (let col = 5; col <= 68; col++) {
      const day = +sheet.getRow(15).getCell(col).text,
        month = +sheet.getRow(16).getCell(col).text;
      if (!day || !month) continue;
      const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const period = (periods[date] = (periods[date] || 0) + 1);
      const marks = students
        .map((s) => {
          const cell = sheet.getRow(s.row).getCell(col),
            raw = cell.text,
            status = raw.trim().toUpperCase();
          if (raw && ["P", "A"].includes(status) && raw !== status)
            normalized.push({ cell: cell.address, raw, status });
          if (raw && !["P", "A"].includes(status))
            needsReview.push({
              cell: cell.address,
              raw,
              date,
              period,
              student_id: s.id,
            });
          return { ...s, status };
        })
        .filter((s) => ["P", "A"].includes(s.status));
      const r = db
        .prepare(
          "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(1,?,?,?)",
        )
        .run(date, period, marks.length ? "imported" : "draft");
      for (const m of marks)
        db.prepare("INSERT INTO marks VALUES(?,?,?)").run(
          r.lastInsertRowid,
          m.id,
          m.status,
        );
      if (marks.length) {
        imported++;
        blanks += students.length - marks.length;
      } else empty++;
    }
    audit(db, null, "workbook.migrate", "DL", {
      students: students.length,
      recordedSessions: imported,
      plannedSessions: empty,
      unmarkedHistoricalCells: blanks,
      normalized,
      needsReview,
      source: "Batch 2026 BCA A tracker",
      policy: "Only recorded P/A counted; unrecognized marks require review.",
    });
  } else {
    for (const [i, name] of [
      "Example Student One",
      "Example Student Two",
      "Example Student Three",
    ].entries())
      db.prepare(
        "INSERT INTO students(campus_id,name,class_id) VALUES(?,?,1)",
      ).run(`DEMO-${i + 1}`, name);
  }
  // A separate fictional student keeps portal demonstrations away from real student identities.
  db.prepare(
    "INSERT INTO classes(course_id,admission_year,section,semester,advisor_id) VALUES(1,2026,'DEMO',1,?)",
  ).run(teacher);
  db.prepare(
    "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(2,'Digital Logic (demo)','DEMO-DL',1,?)",
  ).run(teacher);
  const demo = db
    .prepare(
      "INSERT INTO students(campus_id,name,class_id) VALUES('DEMO-PORTAL','Demo Student',2)",
    )
    .run();
  addUser(
    "Demo Student",
    "student@yenepoya.local",
    "student",
    Number(demo.lastInsertRowid),
  );
});
mkdirSync(".local", { recursive: true, mode: 0o700 });
writeFileSync(".local/credentials.json", JSON.stringify(credentials, null, 2), {
  mode: 0o600,
});
console.log(
  "Initialized. Unique local login credentials are in .local/credentials.json (excluded from Git).",
);
db.close();
