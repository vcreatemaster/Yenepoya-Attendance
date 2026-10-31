import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { openDatabase, passwordHash, passwordMatches } from "../server/db.js";
import { previewStaff, commitStaff } from "../server/staff-import.js";
import { createApp } from "../server/app.js";
const headers = [
  "employee_code",
  "name",
  "email",
  "department",
  "position",
  "role",
  "password",
  "subject_ids",
];
const row = [
  "EMP001",
  "Faculty One",
  "faculty@example.test",
  "Computing",
  "Lecturer",
  "teacher",
  "Yen@2026",
  "1,2",
];
async function workbook(rows) {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("Staff");
  s.addRow(headers);
  rows.forEach((r) => s.addRow(r));
  return w.xlsx.writeBuffer();
}
function setup() {
  const db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO users(id,name,email,password,role) VALUES(1,'Admin','admin@test.local',?,'master_admin')",
  ).run(passwordHash("Yen@2026"));
  db.exec(
    "INSERT INTO courses VALUES(1,'BCA','BCA'); INSERT INTO classes VALUES(1,1,2026,'A',1,NULL); INSERT INTO subjects VALUES(1,1,'Logic','DL',1,NULL),(2,1,'Math','MATH',1,NULL)",
  );
  return db;
}
test("staff workbook imports hashed passwords and multiple subjects; duplicates never overwrite", async () => {
  const db = setup();
  try {
    const rows = await previewStaff(await workbook([row]), db, {
      role: "master_admin",
    });
    assert.deepEqual(rows[0].errors, []);
    assert.equal(rows[0].data.password, undefined);
    assert(passwordMatches("Yen@2026", rows[0].password_hash));
    assert.deepEqual(commitStaff(rows, db, { id: 1, role: "master_admin" }), {
      created: 1,
    });
    const staff = db
      .prepare("SELECT * FROM users WHERE employee_code='EMP001'")
      .get();
    assert(passwordMatches("Yen@2026", staff.password));
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM subjects WHERE teacher_id=?")
        .get(staff.id).n,
      2,
    );
    const duplicate = await previewStaff(await workbook([row]), db, {
      role: "master_admin",
    });
    assert(duplicate[0].errors.some((e) => e.includes("already exists")));
    assert(
      !JSON.stringify(db.prepare("SELECT * FROM audit").all()).includes(
        "Yen@2026",
      ),
    );
  } finally {
    db.close();
  }
});
test("validation blocks short passwords, privilege escalation, formulas and duplicate subjects", async () => {
  const db = setup();
  try {
    const invalid = [...row];
    invalid[5] = "admin";
    invalid[6] = "short";
    const rows = await previewStaff(await workbook([invalid, row]), db, {
      role: "admin",
    });
    assert(rows[0].errors.some((e) => e.includes("master")));
    assert(rows[0].errors.some((e) => e.includes("8–128")));
    assert(rows[1].errors.some((e) => e.includes("Duplicate")));
    assert.throws(() => commitStaff(rows, db, { id: 1, role: "admin" }));
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 1);
    const formula = [...row];
    formula[6] = { formula: '"Yen@2026"', result: "Yen@2026" };
    assert(
      (
        await previewStaff(await workbook([formula]), db, {
          role: "master_admin",
        })
      )[0].errors.some((e) => e.includes("formulas")),
    );
  } finally {
    db.close();
  }
});
test("commit revalidates assignments and rolls back all accounts on conflict", async () => {
  const db = setup();
  try {
    const first = [...row];
    first[7] = "1";
    const second = [...row];
    second[0] = "EMP002";
    second[2] = "two@example.test";
    second[7] = "2";
    const rows = await previewStaff(await workbook([first, second]), db, {
      role: "master_admin",
    });
    db.exec("UPDATE subjects SET teacher_id=1 WHERE id=2");
    assert.throws(
      () => commitStaff(rows, db, { id: 1, role: "master_admin" }),
      /assignments changed/,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 1);
    assert.equal(
      db.prepare("SELECT teacher_id FROM subjects WHERE id=1").get().teacher_id,
      null,
    );
  } finally {
    db.close();
  }
});
test("staff import API hides password hashes, authenticates requests and consumes preview once", async () => {
  const db = setup(),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(base + "/staff/import/template")).status, 401);
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
      },
      body: JSON.stringify({ email: "admin@test.local", password: "Yen@2026" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { Cookie: cookie, "X-Requested-With": "Yenepoya" };
    const form = new FormData();
    form.append("file", new Blob([await workbook([row])]), "staff.xlsx");
    const response = await fetch(base + "/staff/import/preview", {
      method: "POST",
      headers,
      body: form,
    });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.valid, true);
    assert(!JSON.stringify(preview).includes("Yen@2026"));
    assert.equal(preview.rows[0].password_hash, undefined);
    const options = {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token }),
    };
    assert.equal(
      (await fetch(base + "/staff/import/commit", options)).status,
      200,
    );
    assert.equal(
      (await fetch(base + "/staff/import/commit", options)).status,
      400,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
