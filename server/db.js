import { migrateTimetable } from "./timetable.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, hash) {
  const [salt, digest] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(digest, "hex"));
}
export function openDatabase(
  path = process.env.DB_PATH || "./data/attendance.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('master_admin','admin','welfare','teacher','student')), student_id INTEGER UNIQUE REFERENCES students(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS auth_sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), admission_year INTEGER NOT NULL, section TEXT NOT NULL, semester INTEGER NOT NULL DEFAULT 1, advisor_id INTEGER REFERENCES users(id), UNIQUE(course_id, admission_year,section));
    CREATE TABLE IF NOT EXISTS subjects(id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), name TEXT NOT NULL, code TEXT NOT NULL, semester INTEGER NOT NULL DEFAULT 1, teacher_id INTEGER REFERENCES users(id), UNIQUE(class_id,code,semester));
    CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, campus_id TEXT UNIQUE NOT NULL, registration_number TEXT DEFAULT '', name TEXT NOT NULL, class_id INTEGER NOT NULL REFERENCES classes(id), blood_group TEXT DEFAULT '', father_name TEXT DEFAULT '', father_phone TEXT DEFAULT '', mother_name TEXT DEFAULT '', mother_phone TEXT DEFAULT '', guardian_name TEXT DEFAULT '', guardian_phone TEXT DEFAULT '', student_phone TEXT DEFAULT '', address TEXT DEFAULT '', notification_phone TEXT DEFAULT '', whatsapp_consent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS teaching_sessions(id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL REFERENCES subjects(id), date TEXT NOT NULL, period INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','imported','cancelled')), revision INTEGER NOT NULL DEFAULT 0, UNIQUE(subject_id,date,period));
    CREATE TABLE IF NOT EXISTS marks(session_id INTEGER NOT NULL REFERENCES teaching_sessions(id), student_id INTEGER NOT NULL REFERENCES students(id), status TEXT NOT NULL CHECK(status IN ('P','A','L','N')), PRIMARY KEY(session_id,student_id));
    CREATE TABLE IF NOT EXISTS leaves(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), from_date TEXT NOT NULL, to_date TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), review_note TEXT DEFAULT '', reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT NOT NULL, type TEXT NOT NULL, class_id INTEGER REFERENCES classes(id), description TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES('threshold','75');
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, student_id INTEGER REFERENCES students(id), kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0, locked_at INTEGER, last_error TEXT DEFAULT '', provider_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS marks_student ON marks(student_id);
    CREATE INDEX IF NOT EXISTS sessions_subject ON teaching_sessions(subject_id,date);
    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,next_attempt);
  `);
  // Additive migration: existing accounts and attendance remain intact.
  transaction(db, () => {
    const userColumns = new Set(
      db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, definition] of Object.entries({
      employee_code: "TEXT COLLATE NOCASE",
      department: "TEXT NOT NULL DEFAULT ''",
      position: "TEXT NOT NULL DEFAULT ''",
      active: "INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))",
      staff_revision: "INTEGER NOT NULL DEFAULT 0",
    }))
      if (!userColumns.has(name))
        db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code ON users(employee_code) WHERE employee_code IS NOT NULL",
    );
  });
  transaction(db, () => migrateTimetable(db));
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function audit(db, user, action, entity, detail) {
  db.prepare(
    "INSERT INTO audit(user_id,action,entity,detail) VALUES(?,?,?,?)",
  ).run(user?.id || null, action, String(entity), JSON.stringify(detail));
}
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const isAdmin = (u) => ["master_admin", "admin"].includes(u.role);
export function allowedClasses(db, user) {
  if (isAdmin(user) || user.role === "welfare")
    return db
      .prepare("SELECT id FROM classes")
      .all()
      .map((x) => x.id);
  if (user.role === "student")
    return db
      .prepare("SELECT class_id AS id FROM students WHERE id=?")
      .all(user.student_id)
      .map((x) => x.id);
  return db
    .prepare("SELECT DISTINCT class_id AS id FROM subjects WHERE teacher_id=?")
    .all(user.id)
    .map((x) => x.id);
}
export function percentages(db, studentId) {
  return db
    .prepare(
      `SELECT sub.id,sub.name,sub.code,sub.semester,u.name AS teacher,
    COUNT(CASE WHEN ts.state IN ('submitted','imported') AND ts.date<=? AND m.status IN ('P','A','L') THEN 1 END) AS total,
    COUNT(CASE WHEN ts.state IN ('submitted','imported') AND ts.date<=? AND m.status IN ('P','L') THEN 1 END) AS attended
    FROM subjects sub LEFT JOIN users u ON u.id=sub.teacher_id
    LEFT JOIN teaching_sessions ts ON ts.subject_id=sub.id
    LEFT JOIN marks m ON m.session_id=ts.id AND m.student_id=?
    WHERE sub.class_id=(SELECT class_id FROM students WHERE id=?) GROUP BY sub.id ORDER BY sub.semester,sub.name`,
    )
    .all(today(), today(), studentId, studentId)
    .map((r) => ({
      ...r,
      percentage: r.total
        ? Math.round((r.attended / r.total) * 1000) / 10
        : null,
    }));
}
export function queueNotification(db, studentId, kind, key, payload) {
  const s = db
    .prepare(
      "SELECT whatsapp_consent,notification_phone FROM students WHERE id=?",
    )
    .get(studentId);
  if (!s?.whatsapp_consent || !s.notification_phone) return;
  db.prepare(
    "INSERT OR IGNORE INTO jobs(dedupe_key,student_id,kind,payload) VALUES(?,?,?,?)",
  ).run(key, studentId, kind, JSON.stringify(payload));
}
