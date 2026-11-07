import test from "node:test";
import assert from "node:assert/strict";
import {
  openDatabase,
  passwordHash,
  today,
  percentages,
} from "../server/db.js";
import { createApp } from "../server/app.js";
const add = (d, n) => {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const day = (d) => new Date(d + "T12:00:00Z").getUTCDay();
async function fixture(t) {
  const db = openDatabase(":memory:");
  db.exec(
    "INSERT INTO courses VALUES(1,'BCA','BCA'); INSERT INTO classes VALUES(1,1,2026,'A',1,NULL),(2,1,2026,'B',1,NULL); INSERT INTO students(id,campus_id,name,class_id) VALUES(1,'S1','Student A',1),(2,'S2','Student B',2);",
  );
  const pass = passwordHash("Test-password-123");
  for (const [id, role, student] of [
    [1, "master_admin", null],
    [2, "teacher", null],
    [3, "teacher", null],
    [4, "student", 1],
    [5, "student", 2],
  ])
    db.prepare(
      "INSERT INTO users(id,name,email,password,role,student_id) VALUES(?,?,?,?,?,?)",
    ).run(id, `Person ${id}`, `${id}@test.local`, pass, role, student);
  db.exec(
    "INSERT INTO subjects VALUES(1,1,'Logic','DL',1,2),(2,2,'Programming','PR',1,2),(3,1,'Mathematics','MA',1,3);",
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  for (let id = 1; id <= 5; id++) {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
      },
      body: JSON.stringify({
        email: `${id}@test.local`,
        password: "Test-password-123",
      }),
    });
    cookies[id] = r.headers.get("set-cookie").split(";")[0];
  }
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const req = async (user, path, method = "GET", body) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Cookie: cookies[user],
        "Content-Type": "application/json",
        "X-Requested-With": "Yenepoya",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const must = async (...args) => {
    const r = await req(...args);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const draft = async ({
    class_id = 1,
    subject_id = 1,
    faculty_id = 2,
    from = today(),
    to = add(from, 7),
    start = "09:00",
    end = "10:00",
    room = "R1",
    source_id,
  } = {}) => {
    const created = await must(1, "/timetables", "POST", {
      class_id,
      semester: 1,
      effective_from: from,
      effective_to: to,
      ...(source_id ? { source_id } : {}),
    });
    const v = await must(1, `/timetables/${created.id}`);
    return must(1, `/timetables/${v.id}`, "PUT", {
      revision: v.revision,
      effective_from: from,
      effective_to: to,
      config: {
        days: [0, 1, 2, 3, 4, 5, 6],
        slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          period: 1,
          start,
          end,
          kind: "class",
        })),
      },
      entries: [
        { day: day(from), period: 1, subject_id, faculty_id, start, end, room },
      ],
    });
  };
  const publish = (v) =>
    must(1, `/timetables/${v.id}/publish`, "POST", { revision: v.revision });
  const schedule = (user = 2, from = today(), to = from) =>
    must(user, `/schedule?from=${from}&to=${to}`);
  const exception = (s) => ({
    revision: s.revision,
    class_id: s.class_id,
    subject_id: s.subject_id,
    faculty_id: s.faculty_id,
    date: s.date,
    period: s.period,
    start: s.start,
    end: s.end,
    room: s.room,
    state: "scheduled",
    holiday_override: false,
    reason: "Authorized schedule change",
  });
  return { db, req, must, draft, publish, schedule, exception };
}
test("draft privacy, publication, scoped daily/weekly schedules and stable attendance links", async (t) => {
  const f = await fixture(t),
    v = await f.draft();
  assert.equal((await f.schedule(4)).sessions.length, 0);
  assert.equal((await f.req(4, `/timetables/${v.id}`)).status, 403);
  assert.equal((await f.req(2, "/timetables?class_id=1")).status, 403);
  const preview = await f.must(1, `/timetables/${v.id}/preview`, "POST");
  assert.equal(preview.errors.length, 0);
  await f.publish(v);
  assert.equal(
    (await f.schedule(4, today(), add(today(), 7))).sessions.length,
    2,
  );
  assert.equal((await f.schedule(5)).sessions.length, 0);
  assert.equal((await f.schedule(3)).sessions.length, 0);
  const s = (await f.schedule()).sessions[0];
  const first = await f.must(2, `/schedule/${s.id}/attendance`, "POST");
  const again = await f.must(2, `/schedule/${s.id}/attendance`, "POST");
  assert.equal(first.attendance_id, again.attendance_id);
  assert.equal(first.class_id, 1);
  assert.equal(first.subject_id, 1);
  assert.equal(first.date, today());
  assert.equal(first.period, 1);
  assert.equal(
    (await f.req(3, `/schedule/${s.id}/attendance`, "POST")).status,
    403,
  );
  assert.equal(
    (await f.req(4, `/schedule/${s.id}/attendance`, "POST")).status,
    403,
  );
  assert.equal(
    (
      await f.req(2, "/attendance/sessions", "POST", {
        subject_id: 1,
        date: today(),
        period: 2,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.req(2, `/attendance/sessions/${first.attendance_id}`, "PUT", {
        revision: 0,
        state: "submitted",
        marks: [],
      })
    ).status,
    400,
  );
  await f.must(2, `/attendance/sessions/${first.attendance_id}`, "PUT", {
    revision: 0,
    state: "submitted",
    marks: [{ student_id: 1, status: "L" }],
  });
  assert.equal(percentages(f.db, 1).find((s) => s.id === 1).percentage, 100);
  assert.equal(
    (
      await f.req(2, `/attendance/sessions/${first.attendance_id}`, "PUT", {
        revision: 1,
        state: "draft",
        marks: [{ student_id: 1, status: "A" }],
      })
    ).status,
    403,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM teaching_sessions").get().n,
    1,
  );
});
test("backend validates faculty eligibility, class periods, room and cross-class overlaps at publish", async (t) => {
  const f = await fixture(t);
  await f.publish(await f.draft());
  const v = await f.draft({
    class_id: 2,
    subject_id: 2,
    start: "09:30",
    end: "10:30",
    room: "R2",
  });
  const preview = await f.must(1, `/timetables/${v.id}/preview`, "POST");
  assert.match(preview.errors.join(" "), /Person 2.*Section A/);
  assert.equal(
    (
      await f.req(1, `/timetables/${v.id}/publish`, "POST", {
        revision: v.revision,
      })
    ).status,
    409,
  );
  const wrong = {
    revision: v.revision,
    effective_from: v.effective_from,
    effective_to: v.effective_to,
    config: v.config,
    entries: [{ ...v.entries[0], faculty_id: 3 }],
  };
  assert.equal(
    (await f.req(1, `/timetables/${v.id}`, "PUT", wrong)).status,
    400,
  );
  const bad = await f.req(1, "/schedule", "POST", {
    class_id: 2,
    subject_id: 2,
    faculty_id: 3,
    date: today(),
    period: 2,
    start: "09:30",
    end: "10:30",
    room: "R1",
    reason: "Approved extra class",
  });
  assert.equal(bad.status, 409);
  assert.match(bad.body.error, /Room/);
  const dup = { ...wrong, entries: [v.entries[0], v.entries[0]] };
  assert.equal((await f.req(1, `/timetables/${v.id}`, "PUT", dup)).status, 400);
});
test("single-occurrence substitution, rescheduling, cancellation and extra classes are audited and permission controlled", async (t) => {
  const f = await fixture(t);
  await f.publish(await f.draft());
  let s = (await f.schedule()).sessions[0];
  assert.equal(
    (
      await f.req(2, `/schedule/${s.id}`, "PUT", {
        ...f.exception(s),
        faculty_id: 3,
      })
    ).status,
    403,
  );
  await f.must(1, `/schedule/${s.id}`, "PUT", {
    ...f.exception(s),
    faculty_id: 3,
  });
  assert.equal((await f.schedule(2)).sessions.length, 0);
  s = (await f.schedule(3)).sessions[0];
  assert.equal(s.change_type, "substitute");
  assert.equal(
    (await f.req(2, `/schedule/${s.id}/attendance`, "POST")).status,
    403,
  );
  const access = await f.must(3, `/attendance?scheduled_session_id=${s.id}`);
  assert.equal(access.students.length, 1);
  assert.equal(access.sessions.length, 0);
  assert.equal((await f.req(3, "/attendance?subject_id=1")).status, 403);
  await f.must(1, `/schedule/${s.id}`, "PUT", {
    ...f.exception(s),
    date: add(today(), 1),
  });
  s = (await f.schedule(3, add(today(), 1))).sessions[0];
  assert.equal(s.change_type, "rescheduled");
  await f.must(1, `/schedule/${s.id}`, "PUT", {
    ...f.exception(s),
    state: "cancelled",
  });
  assert.equal(
    (await f.req(3, `/schedule/${s.id}/attendance`, "POST")).status,
    400,
  );
  const extra = await f.must(1, "/schedule", "POST", {
    class_id: 1,
    subject_id: 3,
    faculty_id: 3,
    date: today(),
    period: 2,
    start: "11:00",
    end: "12:00",
    room: "Lab",
    reason: "Approved extra class",
  });
  const register = await f.must(3, `/schedule/${extra.id}/attendance`, "POST");
  assert.equal(register.period, 2);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM audit WHERE action='schedule.exception'")
      .get().n,
    4,
  );
});
test("published revisions retain attendance identities and reject retroactive changes", async (t) => {
  const f = await fixture(t),
    v = await f.draft();
  await f.publish(v);
  const s = (await f.schedule()).sessions[0];
  const reg = await f.must(2, `/schedule/${s.id}/attendance`, "POST");
  await f.must(2, `/attendance/sessions/${reg.attendance_id}`, "PUT", {
    revision: 0,
    state: "submitted",
    marks: [{ student_id: 1, status: "P" }],
  });
  const same = await f.draft({ source_id: v.id });
  await f.publish(same);
  assert.equal((await f.schedule()).sessions[0].id, s.id);
  const changed = await f.draft({
    source_id: v.id,
    start: "10:00",
    end: "11:00",
  });
  assert.equal(
    (
      await f.req(1, `/timetables/${changed.id}/publish`, "POST", {
        revision: changed.revision,
      })
    ).status,
    409,
  );
  const later = await f.draft({
    source_id: v.id,
    from: add(today(), 7),
    to: add(today(), 14),
    start: "10:00",
    end: "11:00",
  });
  await f.publish(later);
  assert.equal(
    f.db
      .prepare("SELECT state FROM teaching_sessions WHERE id=?")
      .get(reg.attendance_id).state,
    "submitted",
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM marks WHERE session_id=?")
      .get(reg.attendance_id).status,
    "P",
  );
  assert.equal(
    (await f.schedule(2, add(today(), 7))).sessions[0].revised,
    true,
  );
  const past = await f.draft({ from: add(today(), -1), to: add(today(), 1) });
  assert.equal(
    (
      await f.req(1, `/timetables/${past.id}/publish`, "POST", {
        revision: past.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.req(1, `/timetables/${v.id}`, "PUT", {
        revision: 2,
        effective_from: today(),
        effective_to: add(today(), 1),
        config: v.config,
        entries: v.entries,
      })
    ).status,
    409,
  );
});
test("holidays suppress ordinary sessions and require explicit extra-class overrides", async (t) => {
  const f = await fixture(t);
  await f.must(1, "/calendar", "POST", {
    title: "Campus holiday",
    date: today(),
    end_date: today(),
    type: "holiday",
    class_id: null,
  });
  await f.publish(await f.draft());
  assert.equal((await f.schedule(4)).sessions.length, 0);
  const body = {
    class_id: 1,
    subject_id: 1,
    faculty_id: 2,
    date: today(),
    period: 1,
    start: "09:00",
    end: "10:00",
    room: "R1",
    reason: "Special working class",
  };
  assert.equal((await f.req(1, "/schedule", "POST", body)).status, 400);
  const extra = await f.must(1, "/schedule", "POST", {
    ...body,
    holiday_override: true,
  });
  assert.equal((await f.schedule(4)).sessions[0].holiday, null);
  await f.must(2, `/schedule/${extra.id}/attendance`, "POST");
});
test("holidays added after publication block attendance; cancellation preserves marks", async (t) => {
  const f = await fixture(t);
  await f.publish(await f.draft());
  let s = (await f.schedule()).sessions[0];
  const reg = await f.must(2, `/schedule/${s.id}/attendance`, "POST");
  await f.must(2, `/attendance/sessions/${reg.attendance_id}`, "PUT", {
    revision: 0,
    state: "submitted",
    marks: [{ student_id: 1, status: "A" }],
  });
  await f.must(1, `/schedule/${s.id}`, "PUT", {
    ...f.exception(s),
    state: "cancelled",
  });
  assert.equal(
    f.db
      .prepare("SELECT status FROM marks WHERE session_id=?")
      .get(reg.attendance_id).status,
    "A",
  );
  assert.equal(percentages(f.db, 1).find((x) => x.id === 1).total, 0);
  const next = add(today(), 7);
  s = (await f.schedule(2, next)).sessions[0];
  await f.must(1, "/calendar", "POST", {
    title: "New holiday",
    date: next,
    end_date: next,
    type: "holiday",
    class_id: 1,
  });
  assert.equal((await f.schedule(4, next)).sessions[0].holiday, "New holiday");
  assert.equal(
    (await f.req(2, `/schedule/${s.id}/attendance`, "POST")).status,
    400,
  );
});
test("legacy registers are never auto-associated and stale draft writes fail", async (t) => {
  const f = await fixture(t);
  f.db
    .prepare(
      "INSERT INTO teaching_sessions(subject_id,date,period,state) VALUES(1,?,1,'draft')",
    )
    .run(today());
  const v = await f.draft();
  const p = await f.must(1, `/timetables/${v.id}/preview`, "POST");
  assert.match(p.errors.join(" "), /Legacy/);
  assert.equal(
    (
      await f.req(1, `/timetables/${v.id}/publish`, "POST", {
        revision: v.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    f.db.prepare("SELECT scheduled_session_id FROM teaching_sessions").get()
      .scheduled_session_id,
    null,
  );
  assert.equal(
    (
      await f.req(2, "/attendance/sessions/1", "PUT", {
        revision: 0,
        state: "draft",
        marks: [],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.req(1, `/timetables/${v.id}`, "PUT", {
        revision: 0,
        effective_from: v.effective_from,
        effective_to: v.effective_to,
        config: v.config,
        entries: v.entries,
      })
    ).status,
    409,
  );
});
test("config supports Sunday, day-specific times and breaks; overlaps are rejected", async (t) => {
  const f = await fixture(t);
  const config = {
    days: [0, 6],
    slots: [
      { day: 0, period: 1, start: "08:00", end: "09:00", kind: "class" },
      { day: 0, period: 2, start: "09:00", end: "09:15", kind: "break" },
      { day: 6, period: 1, start: "10:00", end: "11:00", kind: "class" },
    ],
  };
  await f.must(1, "/timetable/config", "PUT", config);
  assert.deepEqual((await f.must(1, "/timetable/config")).days, [0, 6]);
  assert.equal(
    (
      await f.req(1, "/timetable/config", "PUT", {
        ...config,
        slots: [
          ...config.slots,
          { day: 0, period: 3, start: "08:30", end: "09:30", kind: "class" },
        ],
      })
    ).status,
    400,
  );
});

test("concurrent attendance opens are idempotent; register cancellations update the published occurrence", async (t) => {
  const f = await fixture(t);
  await f.publish(await f.draft());
  const s = (await f.schedule()).sessions[0];
  const registers = await Promise.all([
    f.must(2, `/schedule/${s.id}/attendance`, "POST"),
    f.must(2, `/schedule/${s.id}/attendance`, "POST"),
  ]);
  assert.equal(registers[0].attendance_id, registers[1].attendance_id);
  const path = `/attendance/sessions/${registers[0].attendance_id}`;
  assert.equal(
    (
      await f.req(2, path, "PUT", {
        revision: 0,
        state: "cancelled",
        reason: "Not authorized",
        marks: [],
      })
    ).status,
    403,
  );
  await f.must(1, path, "PUT", {
    revision: 0,
    state: "cancelled",
    reason: "Cancelled by administration",
    marks: [],
  });
  assert.equal((await f.schedule(4)).sessions[0].state, "cancelled");
  assert.equal(
    (await f.req(2, `/schedule/${s.id}/attendance`, "POST")).status,
    400,
  );
  await f.must(1, path, "PUT", {
    revision: 1,
    state: "cancelled",
    reason: "Correct retained record",
    marks: [{ student_id: 1, status: "L" }],
  });
  assert.equal(percentages(f.db, 1).find((s) => s.id === 1).total, 0);
  assert.equal(
    (
      await f.req(1, path, "PUT", {
        revision: 2,
        state: "submitted",
        reason: "Cannot reopen implicitly",
        marks: [{ student_id: 1, status: "L" }],
      })
    ).status,
    400,
  );
});
