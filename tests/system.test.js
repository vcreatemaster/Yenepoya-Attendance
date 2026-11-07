import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createServer } from "vite";
import viteConfig from "../vite.config.js";
import {
  openDatabase,
  passwordHash,
  percentages,
  queueNotification,
  today,
} from "../server/db.js";
import { createApp } from "../server/app.js";
import { previewImport, commitImport, importFields } from "../server/import.js";
import { processJob } from "../server/worker.js";

let db, server, base;
const cookies = {};
const password = "A-secure-test-password";
before(async () => {
  db = openDatabase(":memory:");
  const add = (id, name, role, student = null) =>
    db
      .prepare(
        "INSERT INTO users(id,name,email,password,role,student_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        name,
        name + "@test.local",
        passwordHash(password),
        role,
        student,
      );
  add(1, "admin", "master_admin");
  add(2, "teacher", "teacher");
  add(3, "other", "teacher");
  add(4, "welfare", "welfare");
  db.exec(
    "INSERT INTO courses VALUES(1,'BCA','BCA'); INSERT INTO classes VALUES(1,1,2026,'A',1,2); INSERT INTO classes VALUES(2,1,2026,'B',1,3); INSERT INTO subjects VALUES(1,1,'Digital Logic','DL',1,2); INSERT INTO subjects VALUES(2,2,'Mathematics','MATH',1,3); INSERT INTO students(id,campus_id,name,class_id) VALUES(1,'S001','Student One',1),(2,'S002','Student Two',1),(3,'S003','Student Three',2);",
  );
  add(5, "student", "student", 1);
  add(6, "student2", "student", 2);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const name of [
    "admin",
    "teacher",
    "other",
    "welfare",
    "student",
    "student2",
  ]) {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
      },
      body: JSON.stringify({ email: name + "@test.local", password }),
    });
    assert.equal(r.status, 200);
    cookies[name] = r.headers.get("set-cookie").split(";")[0];
  }
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});
const request = async (user, path, method = "GET", body) => {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      ...(cookies[user] ? { Cookie: cookies[user] } : {}),
      "Content-Type": "application/json",
      "X-Requested-With": "Yenepoya",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};

test("development proxy preserves same-origin authentication protection", async () => {
  const vite = await createServer({
    ...viteConfig,
    configFile: false,
    cacheDir: ".local/test-vite-cache",
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: { "/api": { ...viteConfig.server.proxy["/api"], target: base } },
    },
  });
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const login = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
        Origin: origin,
      },
      body: JSON.stringify({ email: "student@test.local", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const blocked = await fetch(origin + "/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Requested-With": "Yenepoya",
        Origin: "https://untrusted.example",
      },
    });
    assert.equal(blocked.status, 403);
  } finally {
    await vite.close();
  }
});
test("authentication, CSRF header, and data isolation", async () => {
  assert.equal((await request(null, "/students")).status, 401);
  const s = await request("student", "/students");
  assert.equal(s.body.length, 1);
  assert.equal(s.body[0].id, 1);
  assert.equal(s.body[0].father_phone, undefined);
  const grid = await request("student", "/attendance?subject_id=1");
  assert.equal(grid.body.students.length, 1);
  assert.equal(
    (await request("student", "/attendance?subject_id=2")).status,
    403,
  );
  assert.equal(
    (await request("other", "/attendance?subject_id=1")).status,
    403,
  );
  assert.equal((await request("student", "/audit")).status, 403);
  const csrf = await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookies.admin },
  });
  assert.equal(csrf.status, 403);
  const cross = await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: cookies.admin,
      "X-Requested-With": "Yenepoya",
      Origin: "https://untrusted.example",
    },
  });
  assert.equal(cross.status, 403);
});
test("subject write access, full submission, lock, audit and stale version protection", async () => {
  const created = await request("admin", "/attendance/sessions", "POST", {
    subject_id: 1,
    date: "2026-01-10",
    period: 1,
  });
  assert.equal(created.status, 200);
  const sid = created.body.id;
  assert.equal(
    (
      await request("other", "/attendance/sessions", "POST", {
        subject_id: 1,
        date: "2026-01-10",
        period: 2,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("welfare", `/attendance/sessions/${sid}`, "PUT", {
        revision: 0,
        state: "draft",
        marks: [],
      })
    ).status,
    403,
  );
  const incomplete = await request(
    "admin",
    `/attendance/sessions/${sid}`,
    "PUT",
    {
      revision: 0,
      state: "submitted",
      marks: [{ student_id: 1, status: "P" }],
    },
  );
  assert.equal(incomplete.status, 400);
  const save = await request("admin", `/attendance/sessions/${sid}`, "PUT", {
    revision: 0,
    state: "submitted",
    marks: [
      { student_id: 1, status: "P" },
      { student_id: 2, status: "A" },
    ],
  });
  assert.equal(save.status, 200);
  const b = {
    revision: 1,
    state: "submitted",
    marks: [
      { student_id: 1, status: "A" },
      { student_id: 2, status: "P" },
    ],
  };
  assert.equal(
    (await request("teacher", `/attendance/sessions/${sid}`, "PUT", b)).status,
    403,
  );
  assert.equal(
    (await request("admin", `/attendance/sessions/${sid}`, "PUT", b)).status,
    403,
  );
  assert.equal(
    (
      await request("admin", `/attendance/sessions/${sid}`, "PUT", {
        ...b,
        reason: "Corrected after register verification",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("admin", `/attendance/sessions/${sid}`, "PUT", {
        ...b,
        reason: "Stale edit",
      })
    ).status,
    409,
  );
  assert.equal(
    db
      .prepare("SELECT status FROM marks WHERE session_id=? AND student_id=1")
      .get(sid).status,
    "A",
  );
  const a = db
    .prepare(
      "SELECT detail FROM audit WHERE action='attendance.save' ORDER BY id DESC",
    )
    .get();
  assert.equal(JSON.parse(a.detail).before[0].status, "P");
});
test("percentages exclude planned sessions, drafts, unmarked cells, N, cancellations and future records", () => {
  db.exec("INSERT INTO subjects VALUES(3,1,'Counting Test','COUNT',1,2)");
  const add = (state, status, date = "2026-01-01") => {
    const r = db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(3,?,?,?)",
      )
      .run(
        date,
        db.prepare("SELECT COUNT(*) n FROM teaching_sessions").get().n + 1,
        state,
      );
    if (status)
      db.prepare("INSERT INTO marks VALUES(?,1,?)").run(
        r.lastInsertRowid,
        status,
      );
  };
  add("submitted", "P");
  add("submitted", "A");
  add("submitted", "L");
  add("submitted", "N");
  add("submitted", null);
  add("draft", "A");
  add("cancelled", "A");
  add("imported", "A", "2099-01-01");
  const p = percentages(db, 1).find((s) => s.id === 3);
  assert.equal(p.total, 3);
  assert.equal(p.attended, 2);
  assert.equal(p.percentage, 66.7);
});
test("future submissions, duplicate sessions, invalid marks and invalid dates are rejected", async () => {
  const future = await request("admin", "/attendance/sessions", "POST", {
    subject_id: 1,
    date: "2099-01-01",
    period: 1,
  });
  assert.equal(future.status, 200);
  assert.equal(
    (
      await request("admin", `/attendance/sessions/${future.body.id}`, "PUT", {
        revision: 0,
        state: "submitted",
        marks: [
          { student_id: 1, status: "P" },
          { student_id: 2, status: "P" },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin", "/attendance/sessions", "POST", {
        subject_id: 1,
        date: "2099-01-01",
        period: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("admin", "/attendance/sessions", "POST", {
        subject_id: 1,
        date: "2026-02-30",
        period: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin", `/attendance/sessions/${future.body.id}`, "PUT", {
        revision: 0,
        state: "draft",
        marks: [{ student_id: 3, status: "P" }],
      })
    ).status,
    400,
  );
});
test("leave request validation, student isolation, review race and rejection notes", async () => {
  const b = {
    from_date: "2026-10-25",
    to_date: "2026-10-26",
    category: "personal",
    reason: "Family appointment requiring leave",
  };
  assert.equal((await request("teacher", "/leaves", "POST", b)).status, 403);
  assert.equal(
    (
      await request("student", "/leaves", "POST", {
        ...b,
        to_date: "2026-10-24",
      })
    ).status,
    400,
  );
  const l = await request("student", "/leaves", "POST", b);
  assert.equal(l.status, 200);
  db.prepare(
    "UPDATE students SET student_phone=?,father_name=?,father_phone=? WHERE id=1",
  ).run("+91 90000 00001", "Test Parent", "+91 90000 00002");
  for (const role of ["admin", "welfare"]) {
    const contacts = await request(role, `/leaves/${l.body.id}/contacts`);
    assert.equal(contacts.status, 200);
    assert.equal(contacts.body.student_phone, "+91 90000 00001");
    assert.equal(contacts.body.father_name, "Test Parent");
    assert.equal(contacts.body.father_phone, "+91 90000 00002");
    assert.equal(contacts.body.mother_phone, "");
    assert.equal(contacts.body.guardian_phone, "");
    assert.equal(contacts.body.address, undefined);
  }
  for (const role of ["teacher", "student", "student2"]) {
    assert.equal(
      (await request(role, `/leaves/${l.body.id}/contacts`)).status,
      403,
    );
  }
  assert.equal(
    (await request("welfare", "/leaves/999999/contacts")).status,
    404,
  );
  db.exec(
    "UPDATE students SET student_phone='',father_name='',father_phone='' WHERE id=1",
  );
  assert.equal((await request("student", "/leaves", "POST", b)).status, 409);
  assert.equal((await request("student2", "/leaves")).body.length, 0);
  assert.equal(
    (
      await request("teacher", `/leaves/${l.body.id}/review`, "POST", {
        status: "approved",
        note: "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("welfare", `/leaves/${l.body.id}/review`, "POST", {
        status: "rejected",
        note: "",
      })
    ).status,
    400,
  );
  const before = JSON.stringify(percentages(db, 1));
  assert.equal(
    (
      await request("welfare", `/leaves/${l.body.id}/review`, "POST", {
        status: "approved",
        note: "Approved",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("admin", `/leaves/${l.body.id}/review`, "POST", {
        status: "approved",
        note: "Also approved",
      })
    ).status,
    409,
  );
  assert.equal(JSON.stringify(percentages(db, 1)), before);
});
test("student import validates every row, detects duplicates, and safely updates by campus ID", async () => {
  const wb = new ExcelJS.Workbook(),
    s = wb.addWorksheet("Students");
  s.addRow(importFields);
  s.addRow(["Imported Student", "BCA", "2026", "A", "IMPORT-01", "", "O+"]);
  let rows = await previewImport(await wb.xlsx.writeBuffer(), db);
  assert.equal(rows[0].errors.length, 0);
  commitImport(rows, db, { id: 1 });
  const count = db.prepare("SELECT COUNT(*) n FROM students").get().n;
  s.getCell("A2").value = "Updated Name";
  rows = await previewImport(await wb.xlsx.writeBuffer(), db);
  assert.equal(rows[0].action, "update");
  commitImport(rows, db, { id: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM students").get().n, count);
  assert.equal(
    db.prepare("SELECT name FROM students WHERE campus_id='IMPORT-01'").get()
      .name,
    "Updated Name",
  );
  s.addRow(["Duplicate", "BCA", "2026", "A", "IMPORT-01"]);
  rows = await previewImport(await wb.xlsx.writeBuffer(), db);
  assert(rows[1].errors.includes("Duplicate campus ID in workbook"));
  s.getCell("D2").value = "B";
  rows = await previewImport(await wb.xlsx.writeBuffer(), db);
  assert(rows[0].errors.some((e) => e.includes("Class transfer")));
});
test("calendar holiday prevents sessions for the applicable class", async () => {
  assert.equal(
    (
      await request("student", "/calendar", "POST", {
        title: "No",
        date: today(),
        end_date: today(),
        type: "holiday",
        class_id: null,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("admin", "/calendar", "POST", {
        title: "Holiday",
        date: "2026-12-25",
        end_date: "2026-12-25",
        type: "holiday",
        class_id: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("admin", "/attendance/sessions", "POST", {
        subject_id: 1,
        date: "2026-12-25",
        period: 1,
      })
    ).status,
    400,
  );
});
test("notification queue deduplicates, respects consent, supports dry-run and retry", async () => {
  queueNotification(db, 1, "leave", "no-consent", { message: "Test" });
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM jobs WHERE dedupe_key='no-consent'")
      .get().n,
    0,
  );
  db.prepare(
    "UPDATE students SET notification_phone='+919876543210',whatsapp_consent=1 WHERE id=1",
  ).run();
  queueNotification(db, 1, "leave", "dry-test", { message: "Test" });
  queueNotification(db, 1, "leave", "dry-test", { message: "Test" });
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM jobs WHERE dedupe_key='dry-test'").get()
      .n,
    1,
  );
  let sends = 0;
  await processJob(
    db,
    async () => {
      sends++;
      return "id";
    },
    "dry-run",
  );
  assert.equal(sends, 0);
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE dedupe_key='dry-test'").get()
      .status,
    "dry_run",
  );
  queueNotification(db, 1, "leave", "retry-test", { message: "Test" });
  await processJob(
    db,
    async () => {
      throw { retryable: true, safeMessage: "Rate limited" };
    },
    "live",
  );
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE dedupe_key='retry-test'").get()
      .status,
    "retry",
  );
  db.exec("UPDATE jobs SET next_attempt=0 WHERE dedupe_key='retry-test'");
  await processJob(
    db,
    async () => {
      sends++;
      return "provider-123";
    },
    "live",
  );
  assert.equal(sends, 1);
  assert.equal(
    db
      .prepare("SELECT provider_id FROM jobs WHERE dedupe_key='retry-test'")
      .get().provider_id,
    "provider-123",
  );
  queueNotification(db, 1, "leave", "revoked", { message: "Test" });
  db.exec("UPDATE students SET whatsapp_consent=0 WHERE id=1");
  await processJob(
    db,
    async () => {
      sends++;
    },
    "live",
  );
  assert.equal(sends, 1);
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE dedupe_key='revoked'").get()
      .status,
    "cancelled",
  );
});
test("notification worker quarantines ambiguous outcomes and stale claims", async () => {
  db.exec("UPDATE students SET whatsapp_consent=1 WHERE id=1");
  queueNotification(db, 1, "leave", "ambiguous", { message: "Test" });
  await processJob(
    db,
    async () => {
      throw { ambiguous: true, safeMessage: "Unknown network outcome" };
    },
    "live",
  );
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE dedupe_key='ambiguous'").get()
      .status,
    "needs_review",
  );
  queueNotification(db, 1, "leave", "stale", { message: "Test" });
  db.exec(
    "UPDATE jobs SET status='processing',locked_at=1 WHERE dedupe_key='stale'",
  );
  await processJob(db, async () => {}, "live");
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE dedupe_key='stale'").get().status,
    "needs_review",
  );
});
test("eight-character passwords work for creation, login, and password changes", async () => {
  const account = {
    name: "Password Test",
    email: "password-test@test.local",
    password: "Yen@2026",
    role: "teacher",
    student_id: null,
  };
  assert.equal(
    (
      await request("admin", "/users", "POST", {
        ...account,
        password: "Short@1",
      })
    ).status,
    400,
  );
  assert.equal((await request("admin", "/users", "POST", account)).status, 200);
  const login = async (password) =>
    fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
      },
      body: JSON.stringify({ email: account.email, password }),
    });
  const signedIn = await login(account.password);
  assert.equal(signedIn.status, 200);
  cookies.passwordTest = signedIn.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await request("passwordTest", "/auth/password", "POST", {
        current: account.password,
        password: "Short@1",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("passwordTest", "/auth/password", "POST", {
        current: account.password,
        password: "Yen@2027",
      })
    ).status,
    200,
  );
  assert.equal((await login("Yen@2027")).status, 200);
  assert.equal((await login(account.password)).status, 401);
});

test("register exports a formatted Excel workbook with logo, month filtering and accurate totals", async () => {
  const subjectId = Number(
    db
      .prepare(
        "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(1,'Export Subject','EXPORT',1,2)",
      )
      .run().lastInsertRowid,
  );
  for (const [date, period, state, status] of [
    ["2026-01-05", 1, "submitted", "P"],
    ["2026-01-05", 2, "submitted", "A"],
    ["2026-01-06", 1, "draft", "P"],
    ["2026-02-02", 1, "submitted", "P"],
  ]) {
    const sid = db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(?,?,?,?)",
      )
      .run(subjectId, date, period, state).lastInsertRowid;
    db.prepare("INSERT INTO marks VALUES(?,1,?)").run(sid, status);
  }
  db.prepare(
    "UPDATE students SET registration_number='000123' WHERE id=1",
  ).run();
  const download = (suffix = "") =>
    fetch(`${base}/api/attendance/export?subject_id=${subjectId}${suffix}`, {
      headers: { Cookie: cookies.teacher },
    });
  const response = await download("&month=2026-01");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /spreadsheetml/);
  assert.match(response.headers.get("content-disposition"), /\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(wb.worksheets.length, 1);
  const sheet = wb.worksheets[0];
  assert.equal(sheet.name, "January 2026");
  assert.equal(sheet.getImages().length, 1);
  assert.match(sheet.getCell("C9").value, /BCA 'A'/);
  assert.equal(sheet.getCell("C10").value, "January 2026");
  assert.equal(sheet.getCell("C11").value, "teacher");
  assert.equal(sheet.getCell("C12").value, "Export Subject");
  assert.equal(sheet.getCell("C13").value, "teacher");
  assert.deepEqual(sheet.getRow(15).values.slice(1, 8), [
    "Sl. No.",
    "Campus ID",
    "Reg. No.",
    "Name",
    5,
    5,
    6,
  ]);
  const note = sheet.getCell("F15").note;
  assert.match(
    typeof note === "string" ? note : note.texts.map((t) => t.text).join(""),
    /2026-01-05 · Period 2/,
  );
  assert.equal(sheet.getRow(16).hidden, true);
  assert.equal(sheet.getCell("G16").value, 0);
  let row;
  sheet.eachRow((r) => {
    if (r.getCell(2).value === "S001") row = r.number;
  });
  assert.equal(sheet.getCell(row, 3).value, "000123");
  assert.deepEqual(
    [5, 6, 7].map((c) => sheet.getCell(row, c).value),
    ["P", "A", "P"],
  );
  assert.equal(sheet.getCell(row, 8).result, 1);
  assert.equal(sheet.getCell(row, 9).result, 0.5);
  assert.match(sheet.getCell(row, 9).formula, /SUMPRODUCT/);
  assert.equal(sheet.pageSetup.orientation, "landscape");
  const all = await download();
  const allWorkbook = new ExcelJS.Workbook();
  await allWorkbook.xlsx.load(Buffer.from(await all.arrayBuffer()));
  assert.deepEqual(
    allWorkbook.worksheets.map((s) => s.name),
    ["January 2026", "February 2026"],
  );
  const empty = await download("&month=2026-03");
  assert.equal(empty.status, 200);
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(Buffer.from(await empty.arrayBuffer()));
  assert.equal(
    emptyWorkbook.worksheets[0].getCell("E15").value,
    "No. of classes",
  );
  assert.equal((await download("&month=2026-13")).status, 400);
  for (const role of ["student", "other"])
    assert.equal(
      (await request(role, `/attendance/export?subject_id=${subjectId}`))
        .status,
      403,
    );
});

test("staff profiles support multiple subjects and faculty access stays subject-specific", async () => {
  const insertSubject = (classId, code, teacher = null) =>
    Number(
      db
        .prepare(
          "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(?,?,?,1,?)",
        )
        .run(classId, code, code, teacher).lastInsertRowid,
    );
  const s1 = insertSubject(1, "FAC-ONE"),
    s2 = insertSubject(2, "FAC-TWO"),
    other = insertSubject(1, "PRIVATE-SUBJECT", 3);
  const profile = {
    name: "New Faculty",
    email: "faculty@test.local",
    employee_code: "EMP100",
    department: "Computer Applications",
    position: "Assistant Professor",
    active: true,
    subject_ids: [s1, s2],
  };
  const created = await request("admin", "/staff", "POST", {
    ...profile,
    role: "teacher",
    password: "Yen@2026",
  });
  assert.equal(created.status, 201);
  const facultyId = created.body.id;
  assert.equal(
    (
      await request("admin", "/staff", "POST", {
        ...profile,
        email: "duplicate@test.local",
        employee_code: "emp100",
        subject_ids: [],
        role: "teacher",
        password: "Yen@2026",
      })
    ).status,
    409,
  );
  assert.equal((await request("teacher", "/staff")).status, 403);
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Yenepoya",
    },
    body: JSON.stringify({ email: profile.email, password: "Yen@2026" }),
  });
  assert.equal(login.status, 200);
  cookies.faculty = login.headers.get("set-cookie").split(";")[0];
  const bootstrap = (await request("faculty", "/bootstrap")).body;
  assert.deepEqual(
    bootstrap.subjects.map((s) => s.id).sort((a, b) => a - b),
    [s1, s2],
  );
  assert.equal(bootstrap.classes.length, 2);
  assert.equal(bootstrap.user.employee_code, "EMP100");
  assert.equal(
    (await request("faculty", `/attendance?subject_id=${other}`)).status,
    403,
  );
  assert.equal(
    (await request("faculty", `/attendance/export?subject_id=${other}`)).status,
    403,
  );
  assert.equal(
    (
      await request("faculty", "/attendance/sessions", "POST", {
        subject_id: other,
        date: "2026-01-15",
        period: 1,
      })
    ).status,
    403,
  );
  const session = await request("admin", "/attendance/sessions", "POST", {
    subject_id: s1,
    date: "2026-01-15",
    period: 1,
  });
  assert.equal(session.status, 200);
  assert.equal(
    (
      await request("admin", `/attendance/sessions/${session.body.id}`, "PUT", {
        revision: 0,
        state: "draft",
        marks: [{ student_id: 1, status: "P" }],
      })
    ).status,
    200,
  );
  for (const student of (await request("faculty", "/students")).body)
    assert(student.subjects.every((s) => [s1, s2].includes(s.id)));
  const csv = await fetch(base + "/api/reports/export", {
    headers: { Cookie: cookies.faculty },
  });
  const csvText = await csv.text();
  assert(!csvText.includes("PRIVATE-SUBJECT"));
  assert(csvText.includes("FAC-ONE"));
  assert.equal(
    (
      await request("admin", `/staff/${facultyId}`, "PATCH", {
        ...profile,
        subject_ids: [other],
        revision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    db.prepare("SELECT teacher_id FROM subjects WHERE id=?").get(s1).teacher_id,
    facultyId,
  );
  assert.equal(
    (
      await request("admin", `/staff/${facultyId}`, "PATCH", {
        ...profile,
        subject_ids: [s2],
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("faculty", `/attendance?subject_id=${s1}`)).status,
    403,
  );
  assert.equal(
    (
      await request("admin", `/staff/${facultyId}`, "PATCH", {
        ...profile,
        subject_ids: [s2],
        revision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("admin", `/staff/${facultyId}`, "PATCH", {
        ...profile,
        active: false,
        subject_ids: [s2],
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal((await request("faculty", "/bootstrap")).status, 401);
  assert.equal(
    (
      await request(null, "/auth/login", "POST", {
        email: profile.email,
        password: "Yen@2026",
      })
    ).status,
    401,
  );
  const saved = (await request("admin", "/staff")).body.find(
    (s) => s.id === facultyId,
  );
  assert.equal(saved.position, profile.position);
  assert.equal(saved.department, profile.department);
  assert.equal(saved.active, 0);
  assert.equal(
    (
      await request("admin", `/subjects/${s1}`, "PATCH", {
        teacher_id: facultyId,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("admin", `/subjects/${s1}`, "PATCH", { teacher_id: 4 }))
      .status,
    400,
  );
  assert.equal(
    (await request("teacher", `/attendance?subject_id=${other}`)).status,
    403,
  );
  assert.deepEqual(
    saved.subjects.map((s) => s.id),
    [s2],
  );
});

test("staff password resets revoke sessions and protected accounts cannot be disabled", async () => {
  const faculty = db
    .prepare("SELECT * FROM users WHERE employee_code='EMP100'")
    .get();
  db.prepare("UPDATE users SET active=1 WHERE id=?").run(faculty.id);
  const login = await request(null, "/auth/login", "POST", {
    email: faculty.email,
    password: "Yen@2026",
  });
  assert.equal(login.status, 200);
  assert(
    db
      .prepare("SELECT COUNT(*) n FROM auth_sessions WHERE user_id=?")
      .get(faculty.id).n > 0,
  );
  assert.equal(
    (
      await request("teacher", `/staff/${faculty.id}/password`, "POST", {
        password: "Yen@2027",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("admin", `/staff/${faculty.id}/password`, "POST", {
        password: "Yen@2027",
      })
    ).status,
    200,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM auth_sessions WHERE user_id=?")
      .get(faculty.id).n,
    0,
  );
  assert.equal(
    (
      await request(null, "/auth/login", "POST", {
        email: faculty.email,
        password: "Yen@2026",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(null, "/auth/login", "POST", {
        email: faculty.email,
        password: "Yen@2027",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("admin", "/staff/1/password", "POST", {
        password: "Yen@2027",
      })
    ).status,
    403,
  );
  const detail = JSON.parse(
    db
      .prepare(
        "SELECT detail FROM audit WHERE action='staff.password_reset' ORDER BY id DESC",
      )
      .get().detail,
  );
  assert.equal(detail.password, undefined);
});

test("account creation restricts elevation and enforces linked students", async () => {
  const b = {
    name: "New Admin",
    email: "new@test.local",
    password,
    role: "admin",
    student_id: null,
  };
  assert.equal((await request("teacher", "/users", "POST", b)).status, 403);
  assert.equal((await request("admin", "/users", "POST", b)).status, 200);
  assert.equal(
    (
      await request("admin", "/users", "POST", {
        ...b,
        email: "unlinked@test.local",
        role: "student",
      })
    ).status,
    400,
  );
});

test("student reports include attendance and leave history with role-scoped access and safe editing", async () => {
  const studentId = Number(
    db
      .prepare(
        "INSERT INTO students(campus_id,name,class_id,father_phone,address) VALUES('REPORT-1','Report Student',1,'9000000001','Private address')",
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO leaves(student_id,from_date,to_date,category,reason,status) VALUES(?,'2026-10-01','2026-10-03','medical','Approved medical leave','approved'),(?,'2026-10-03','2026-10-04','personal','Overlapping approved leave','approved'),(?,'2026-10-05','2026-10-06','personal','Pending personal leave','pending')",
  ).run(studentId, studentId, studentId);
  const subjectId = Number(
    db
      .prepare(
        "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(1,'Report subject','REPORT',1,2)",
      )
      .run().lastInsertRowid,
  );
  const privateSubject = Number(
    db
      .prepare(
        "INSERT INTO subjects(class_id,name,code,semester,teacher_id) VALUES(1,'Other faculty subject','PRIVATE',1,3)",
      )
      .run().lastInsertRowid,
  );
  const sessionId = Number(
    db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(?,'2020-01-01',1,'submitted')",
      )
      .run(subjectId).lastInsertRowid,
  );
  const draftId = Number(
    db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(?,'2020-01-02',1,'draft')",
      )
      .run(subjectId).lastInsertRowid,
  );
  const otherSession = Number(
    db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(?,'2020-01-01',1,'submitted')",
      )
      .run(privateSubject).lastInsertRowid,
  );
  db.prepare("INSERT INTO marks VALUES(?,?,'P'),(?,?,'A'),(?,?,'A')").run(
    sessionId,
    studentId,
    draftId,
    studentId,
    otherSession,
    studentId,
  );
  const path = `/students/${studentId}/report`;
  const report = await request("admin", path);
  assert.equal(report.status, 200);
  assert.equal(report.body.approved_leave_days, 4);
  assert.equal(report.body.leaves.length, 3);
  assert.equal(report.body.student.father_phone, "9000000001");
  assert.equal(
    report.body.history.find((r) => r.id === sessionId).counted,
    true,
  );
  assert.equal(
    report.body.history.find((r) => r.id === draftId).counted,
    false,
  );
  assert.equal(
    report.body.subjects.find((s) => s.id === subjectId).percentage,
    100,
  );
  const teacher = await request("teacher", path);
  assert.equal(teacher.status, 200);
  assert.equal(teacher.body.student.address, undefined);
  assert.equal(teacher.body.student.father_phone, undefined);
  assert.equal(teacher.body.revision, undefined);
  assert.equal(teacher.body.leaves.length, 0);
  assert(!teacher.body.history.some((r) => r.subject_id === privateSubject));
  assert(!teacher.body.subjects.some((r) => r.id === privateSubject));
  assert.equal((await request("student", path)).status, 403);
  assert.equal((await request("welfare", path)).body.leaves.length, 3);
  const fields = [
    "name",
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
    "class_id",
    "status",
  ];
  const payload = Object.fromEntries(
    fields.map((k) => [k, report.body.student[k]]),
  );
  payload.revision = report.body.revision;
  payload.name = "Updated Report Student";
  assert.equal(
    (await request("welfare", `/students/${studentId}`, "PATCH", payload))
      .status,
    403,
  );
  assert.equal(
    (
      await request("admin", `/students/${studentId}`, "PATCH", {
        ...payload,
        class_id: 2,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin", `/students/${studentId}`, "PATCH", {
        ...payload,
        campus_id: "S001",
      })
    ).status,
    409,
  );
  assert.equal(
    (await request("admin", `/students/${studentId}`, "PATCH", payload)).status,
    200,
  );
  assert.equal(
    (await request("admin", `/students/${studentId}`, "PATCH", payload)).status,
    409,
  );
  assert.equal(
    db.prepare("SELECT name FROM students WHERE id=?").get(studentId).name,
    "Updated Report Student",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM marks WHERE student_id=?").get(studentId)
      .n,
    3,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='student.update' AND entity=?",
      )
      .get(String(studentId)).n,
    1,
  );
});

test("three-status API preserves legacy N, rejects new N, and requires explicit marks", async () => {
  db.exec(
    "INSERT INTO classes(id,course_id,admission_year,section,semester,advisor_id) VALUES(90,1,2026,'Legacy',1,2); INSERT INTO subjects(id,class_id,name,code,semester,teacher_id) VALUES(90,90,'Legacy checks','LEG',1,2); INSERT INTO students(id,campus_id,name,class_id) VALUES(901,'LEG1','Legacy student',90),(902,'LEG2','Current student',90);",
  );
  const sid = Number(
    db
      .prepare(
        "INSERT INTO teaching_sessions(subject_id,date,period) VALUES(90,'2026-01-02',19)",
      )
      .run().lastInsertRowid,
  );
  db.prepare("INSERT INTO marks VALUES(?,901,'N')").run(sid);
  const save = (marks, state = "draft", revision = 0, user = "admin", reason) =>
    request(user, `/attendance/sessions/${sid}`, "PUT", {
      marks,
      state,
      revision,
      reason,
    });
  assert.equal((await save([{ student_id: 902, status: "N" }])).status, 400);
  assert.equal((await save([{ student_id: 901, status: "P" }])).status, 400);
  assert.equal((await save([{ student_id: 901, status: "" }])).status, 400);
  assert.equal(
    (await save([{ student_id: 902, status: "" }], "submitted")).status,
    400,
  );
  assert.equal((await save([{ student_id: 902, status: "L" }])).status, 200);
  let data = (await request("teacher", "/attendance?subject_id=90")).body;
  assert.equal(
    data.marks.find((m) => m.session_id === sid && m.student_id === 901).status,
    "N",
  );
  assert.equal(
    data.marks.find((m) => m.session_id === sid && m.student_id === 902).status,
    "L",
  );
  assert.equal(
    (await save([{ student_id: 902, status: "P" }], "submitted", 1)).status,
    200,
  );
  assert.equal(
    (await save([{ student_id: 902, status: "A" }], "submitted", 2, "teacher"))
      .status,
    403,
  );
  assert.equal(
    (
      await save(
        [{ student_id: 902, status: "A" }],
        "submitted",
        2,
        "admin",
        "Verified correction",
      )
    ).status,
    200,
  );
  const detail = JSON.parse(
    db
      .prepare(
        "SELECT detail FROM audit WHERE action='attendance.save' AND entity=? ORDER BY id DESC",
      )
      .get(String(sid)).detail,
  );
  assert.equal(detail.before.find((m) => m.student_id === 901).status, "N");
  assert.equal(detail.after.find((m) => m.student_id === 901).status, "N");
  const exported = await fetch(
    base + "/api/attendance/export?subject_id=90&month=2026-01",
    { headers: { Cookie: cookies.admin } },
  );
  assert.equal(exported.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  let legacyVisible = false;
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value === "N") legacyVisible = true;
      }),
    ),
  );
  assert.equal(legacyVisible, true);
});
