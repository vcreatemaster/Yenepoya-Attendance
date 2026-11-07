import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, passwordHash, passwordMatches } from "../server/db.js";

test("staff migration preserves legacy logins and is safe to run again", () => {
  const dir = mkdtempSync(join(tmpdir(), "yenepoya-staff-"));
  const path = join(dir, "legacy.sqlite");
  let db;
  try {
    db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL COLLATE NOCASE,password TEXT NOT NULL,role TEXT NOT NULL,student_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    db.prepare(
      "INSERT INTO users(id,name,email,password,role) VALUES(1,'Existing Teacher','legacy@test.local',?,'teacher')",
    ).run(passwordHash("Yen@2026"));
    db.close();
    db = openDatabase(path);
    const staff = db.prepare("SELECT * FROM users WHERE id=1").get();
    assert.equal(staff.active, 1);
    assert.equal(staff.employee_code, null);
    assert.equal(staff.name, "Existing Teacher");
    assert(passwordMatches("Yen@2026", staff.password));
    db.prepare(
      "UPDATE users SET employee_code='EMP-EXISTING',department='Computing',position='Lecturer' WHERE id=1",
    ).run();
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
    assert.equal(
      db.prepare("SELECT employee_code FROM users WHERE id=1").get()
        .employee_code,
      "EMP-EXISTING",
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timetable migration preserves legacy attendance and leaves its origin unassigned", () => {
  const dir = mkdtempSync(join(tmpdir(), "yenepoya-timetable-"));
  const path = join(dir, "legacy.sqlite");
  let db;
  try {
    db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE teaching_sessions(id INTEGER PRIMARY KEY,subject_id INTEGER NOT NULL,date TEXT NOT NULL,period INTEGER NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(subject_id,date,period)); INSERT INTO teaching_sessions VALUES(42,1,'2026-01-10',1,'submitted',7);",
    );
    db.close();
    db = openDatabase(path);
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM teaching_sessions WHERE id=42").get() },
      {
        id: 42,
        subject_id: 1,
        date: "2026-01-10",
        period: 1,
        state: "submitted",
        revision: 7,
        scheduled_session_id: null,
      },
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM teaching_sessions").get().n,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM scheduled_sessions").get().n,
      0,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
