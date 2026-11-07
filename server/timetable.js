import { z } from "zod";
import { audit, transaction, today, isAdmin } from "./db.js";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const id = z.coerce.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slot = z.object({
  day: z.number().int().min(0).max(6),
  period: z.number().int().min(1).max(20),
  start: time,
  end: time,
  kind: z.enum(["class", "break"]),
  label: z.string().max(80).default(""),
});
const entry = z.object({
  day: z.number().int().min(0).max(6),
  period: z.number().int().min(1).max(20),
  subject_id: id,
  faculty_id: id,
  start: time,
  end: time,
  room: z.string().trim().max(100).default(""),
});
const configSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  slots: z.array(slot).max(140),
});
export const defaultTimetableConfig = {
  days: [1, 2, 3, 4, 5, 6],
  slots: [1, 2, 3, 4, 5, 6].flatMap((day) =>
    [1, 2, 3, 4, 5, 6].map((period) => ({
      day,
      period,
      start: `${String(8 + period).padStart(2, "0")}:00`,
      end: `${String(9 + period).padStart(2, "0")}:00`,
      kind: "class",
      label: "",
    })),
  ),
};
export function migrateTimetable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS timetable_versions(id INTEGER PRIMARY KEY,class_id INTEGER NOT NULL REFERENCES classes(id),semester INTEGER NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),revision INTEGER NOT NULL DEFAULT 0,config TEXT NOT NULL,created_by INTEGER REFERENCES users(id),published_at TEXT);
 CREATE TABLE IF NOT EXISTS timetable_entries(id INTEGER PRIMARY KEY,version_id INTEGER NOT NULL REFERENCES timetable_versions(id),day INTEGER NOT NULL,period INTEGER NOT NULL,subject_id INTEGER NOT NULL REFERENCES subjects(id),faculty_id INTEGER NOT NULL REFERENCES users(id),start TEXT NOT NULL,end TEXT NOT NULL,room TEXT NOT NULL DEFAULT '',UNIQUE(version_id,day,period));
 CREATE TABLE IF NOT EXISTS scheduled_sessions(id INTEGER PRIMARY KEY,version_id INTEGER REFERENCES timetable_versions(id),entry_id INTEGER REFERENCES timetable_entries(id),origin_date TEXT NOT NULL,origin_period INTEGER NOT NULL,class_id INTEGER NOT NULL REFERENCES classes(id),subject_id INTEGER NOT NULL REFERENCES subjects(id),faculty_id INTEGER NOT NULL REFERENCES users(id),date TEXT NOT NULL,period INTEGER NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,room TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','cancelled','superseded')),change_type TEXT NOT NULL DEFAULT 'standard',holiday_override INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,UNIQUE(version_id,entry_id,origin_date));
 CREATE INDEX IF NOT EXISTS scheduled_date ON scheduled_sessions(date,state);
 CREATE INDEX IF NOT EXISTS scheduled_faculty ON scheduled_sessions(faculty_id,date);`);
  const columns = db.prepare("PRAGMA table_info(teaching_sessions)").all();
  if (!columns.some((c) => c.name === "scheduled_session_id"))
    db.exec(
      "ALTER TABLE teaching_sessions ADD COLUMN scheduled_session_id INTEGER REFERENCES scheduled_sessions(id)",
    );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS attendance_scheduled_unique ON teaching_sessions(scheduled_session_id) WHERE scheduled_session_id IS NOT NULL",
  );
  db.prepare(
    "INSERT OR IGNORE INTO settings(key,value) VALUES('timetable_config',?)",
  ).run(JSON.stringify(defaultTimetableConfig));
}
const dates = (from, to) => {
  const result = [];
  for (
    let d = new Date(from + "T00:00:00Z");
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    result.push(d.toISOString().slice(0, 10));
    if (result.length > 366)
      fail(400, "Use an effective range of at most 366 days.");
  }
  return result;
};
export const holidayFor = (db, s) =>
  db
    .prepare(
      "SELECT title FROM events WHERE type='holiday' AND date<=? AND end_date>=? AND (class_id IS NULL OR class_id=?)",
    )
    .get(s.date, s.date, s.class_id);
const version = (db, value) => {
  const v = db
    .prepare("SELECT * FROM timetable_versions WHERE id=?")
    .get(id.parse(value));
  if (!v) fail(404, "Timetable not found.");
  return {
    ...v,
    config: JSON.parse(v.config),
    entries: db
      .prepare(
        "SELECT * FROM timetable_entries WHERE version_id=? ORDER BY day,period",
      )
      .all(v.id),
  };
};
function validateConfig(c) {
  if (new Set(c.days).size !== c.days.length)
    fail(400, "Working days must be unique.");
  const seen = new Set();
  for (const s of c.slots) {
    const key = `${s.day}:${s.period}`;
    if (!c.days.includes(s.day) || seen.has(key) || s.end <= s.start)
      fail(
        400,
        "Check working days, unique period numbers, and start/end times.",
      );
    seen.add(key);
  }
  for (let i = 0; i < c.slots.length; i++)
    for (let j = 0; j < i; j++) {
      const a = c.slots[i],
        b = c.slots[j];
      if (a.day === b.day && a.start < b.end && b.start < a.end)
        fail(400, "Period schedules and breaks must not overlap.");
    }
}
function validateEntry(db, e, v, substitute = false) {
  const subject = db
    .prepare("SELECT * FROM subjects WHERE id=?")
    .get(e.subject_id);
  const faculty = db
    .prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='teacher'")
    .get(e.faculty_id);
  if (
    !subject ||
    subject.class_id !== v.class_id ||
    subject.semester !== v.semester
  )
    fail(400, "Choose a subject in this class and semester.");
  if (!faculty || (!substitute && subject.teacher_id !== e.faculty_id))
    fail(
      400,
      "Choose the active faculty member assigned to this subject in Academic setup.",
    );
  if (e.start >= e.end) fail(400, "End time must be after start time.");
  if (!substitute) {
    const s = v.config.slots.find(
      (s) => s.day === e.day && s.period === e.period && s.kind === "class",
    );
    if (!s || !v.config.days.includes(e.day))
      fail(400, "Choose a configured teaching period.");
    if (
      v.config.slots.some(
        (s) =>
          s.day === e.day &&
          s.kind === "break" &&
          e.start < s.end &&
          s.start < e.end,
      )
    )
      fail(400, "A teaching session overlaps a configured break.");
  }
}
const joined = `SELECT s.*,sub.name AS subject,u.name AS faculty,c.section,c.admission_year,sub.semester,co.code AS course,t.id AS attendance_id,t.state AS attendance_state FROM scheduled_sessions s JOIN subjects sub ON sub.id=s.subject_id JOIN users u ON u.id=s.faculty_id JOIN classes c ON c.id=s.class_id JOIN courses co ON co.id=c.course_id LEFT JOIN teaching_sessions t ON t.scheduled_session_id=s.id`;
function collision(db, a, b) {
  if (a.date !== b.date) return null;
  const overlap = a.start < b.end && b.start < a.end;
  if (a.class_id === b.class_id && (a.period === b.period || overlap))
    return `This class already has a session on ${a.date}, period ${b.period} (${b.start}–${b.end}).`;
  if (overlap && a.faculty_id === b.faculty_id) {
    const u = db.prepare("SELECT name FROM users WHERE id=?").get(a.faculty_id);
    const c = db
      .prepare(
        "SELECT c.section,co.code FROM classes c JOIN courses co ON co.id=c.course_id WHERE c.id=?",
      )
      .get(b.class_id);
    return `${u.name} is already assigned to ${c.code} Section ${c.section} on ${a.date}, ${b.start}–${b.end}.`;
  }
  if (
    overlap &&
    a.room &&
    b.room &&
    a.room.toLowerCase() === b.room.toLowerCase()
  )
    return `Room ${a.room} is already booked on ${a.date}, ${b.start}–${b.end}.`;
  return null;
}
const same = (a, b) =>
  ["subject_id", "faculty_id", "date", "period", "start", "end", "room"].every(
    (k) => a[k] === b[k],
  );
function publicationPlan(db, v) {
  if (v.effective_from < today())
    fail(
      400,
      "Publish from today or a future date. Historical schedules cannot be revised.",
    );
  if (v.effective_to < v.effective_from)
    fail(400, "Effective end must be on or after the start.");
  validateConfig(v.config);
  if (!v.entries.length)
    fail(400, "Add at least one teaching session before publishing.");
  for (const e of v.entries) validateEntry(db, e, v);
  const existing = db
    .prepare(
      joined +
        " WHERE s.state!='superseded' AND ((s.class_id=? AND s.origin_date BETWEEN ? AND ?) OR s.date BETWEEN ? AND ?)",
    )
    .all(
      v.class_id,
      v.effective_from,
      v.effective_to,
      v.effective_from,
      v.effective_to,
    );
  const replaced = existing.filter(
    (s) =>
      s.class_id === v.class_id &&
      s.version_id &&
      s.origin_date >= v.effective_from &&
      s.origin_date <= v.effective_to &&
      s.change_type === "standard",
  );
  const exceptions = existing.filter(
    (s) =>
      s.class_id === v.class_id && s.version_id && s.change_type !== "standard",
  );
  const generated = [];
  for (const d of dates(v.effective_from, v.effective_to))
    for (const e of v.entries) {
      if (new Date(d + "T00:00:00Z").getUTCDay() !== e.day) continue;
      const s = {
        ...e,
        entry_id: e.id,
        version_id: v.id,
        class_id: v.class_id,
        date: d,
        origin_date: d,
        origin_period: e.period,
      };
      if (
        holidayFor(db, s) ||
        exceptions.some(
          (x) => x.origin_date === d && x.origin_period === e.period,
        )
      )
        continue;
      generated.push(s);
    }
  const kept = [];
  const added = [];
  for (const s of generated) {
    const old = replaced.find((x) => x.state === "scheduled" && same(s, x));
    if (old) kept.push(old);
    else added.push(s);
  }
  const removed = replaced.filter((x) => !kept.some((k) => k.id === x.id));
  if (removed.some((s) => s.attendance_id))
    fail(
      409,
      "This revision changes a session with an attendance register. Choose a later effective date or retain that session unchanged.",
    );
  const unaffected = existing.filter(
    (x) =>
      x.state === "scheduled" &&
      !replaced.some((s) => s.id === x.id) &&
      (!holidayFor(db, x) || x.holiday_override),
  );
  const all = [...unaffected, ...kept, ...added];
  const errors = [];
  const additions = new Set(added),
    byDate = new Map();
  for (const session of all) {
    const peers = byDate.get(session.date) || [];
    for (const other of peers) {
      if (!additions.has(session) && !additions.has(other)) continue;
      const error = collision(db, session, other);
      if (error && !errors.includes(error)) errors.push(error);
    }
    peers.push(session);
    byDate.set(session.date, peers);
  }
  // Legacy attendance is never silently associated with a generated schedule.
  for (const s of added)
    if (
      db
        .prepare(
          "SELECT id FROM teaching_sessions WHERE subject_id=? AND date=? AND period=? AND scheduled_session_id IS NULL",
        )
        .get(s.subject_id, s.date, s.period)
    )
      errors.push(
        `Legacy attendance already exists on ${s.date}, period ${s.period}. Choose a different period or effective date; history will not be relinked.`,
      );
  return {
    kept,
    added,
    removed,
    errors,
    summary: {
      unchanged: kept.length,
      added: added.length,
      removed: removed.length,
      exceptions_preserved: exceptions.length,
    },
  };
}
function insertSession(db, s) {
  return Number(
    db
      .prepare(
        `INSERT INTO scheduled_sessions(version_id,entry_id,origin_date,origin_period,class_id,subject_id,faculty_id,date,period,start,end,room,change_type,holiday_override,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.version_id || null,
        s.entry_id || null,
        s.origin_date || s.date,
        s.origin_period || s.period,
        s.class_id,
        s.subject_id,
        s.faculty_id,
        s.date,
        s.period,
        s.start,
        s.end,
        s.room || "",
        s.change_type || "standard",
        s.holiday_override ? 1 : 0,
        s.reason || "",
      ).lastInsertRowid,
  );
}
export function scheduledAccess(db, user, value, write = false) {
  const s = db.prepare(joined + " WHERE s.id=?").get(id.parse(value));
  if (!s) fail(404, "Scheduled session not found.");
  if (!isAdmin(user) && !(user.role === "teacher" && s.faculty_id === user.id))
    fail(403, "This scheduled session is not assigned to you.");
  if (
    write &&
    (s.state !== "scheduled" || (!s.holiday_override && holidayFor(db, s)))
  )
    fail(
      400,
      "This class is cancelled or falls on a holiday. An administrator must explicitly authorize an override.",
    );
  return s;
}
export function timetableRoutes(app, db, admin) {
  app.get("/api/timetable/config", admin, (_, res) =>
    res.json(
      JSON.parse(
        db
          .prepare("SELECT value FROM settings WHERE key='timetable_config'")
          .get().value,
      ),
    ),
  );
  app.put("/api/timetable/config", admin, (req, res) => {
    const c = configSchema.parse(req.body);
    validateConfig(c);
    transaction(db, () => {
      db.prepare(
        "UPDATE settings SET value=? WHERE key='timetable_config'",
      ).run(JSON.stringify(c));
      audit(db, req.user, "timetable.config", "institution", c);
    });
    res.json({ ok: true });
  });
  app.get("/api/timetables", admin, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM timetable_versions WHERE class_id=? ORDER BY id DESC",
        )
        .all(id.parse(req.query.class_id))
        .map((v) => ({ ...v, config: JSON.parse(v.config) })),
    ),
  );
  app.get("/api/timetables/:id", admin, (req, res) =>
    res.json(version(db, req.params.id)),
  );
  app.post("/api/timetables", admin, (req, res) => {
    const b = z
      .object({
        class_id: id,
        semester: z.coerce.number().int().min(1).max(20),
        effective_from: date,
        effective_to: date,
        source_id: id.optional(),
      })
      .parse(req.body);
    const c = db.prepare("SELECT * FROM classes WHERE id=?").get(b.class_id);
    if (!c) fail(400, "Class not found.");
    if (b.effective_to < b.effective_from)
      fail(400, "Invalid effective range.");
    dates(b.effective_from, b.effective_to);
    let created;
    transaction(db, () => {
      const source = b.source_id ? version(db, b.source_id) : null;
      if (
        source &&
        (source.class_id !== b.class_id || source.semester !== b.semester)
      )
        fail(400, "Revise only the same class and semester.");
      const config =
        source?.config ||
        JSON.parse(
          db
            .prepare("SELECT value FROM settings WHERE key='timetable_config'")
            .get().value,
        );
      created = Number(
        db
          .prepare(
            "INSERT INTO timetable_versions(class_id,semester,effective_from,effective_to,config,created_by) VALUES(?,?,?,?,?,?)",
          )
          .run(
            b.class_id,
            b.semester,
            b.effective_from,
            b.effective_to,
            JSON.stringify(config),
            req.user.id,
          ).lastInsertRowid,
      );
      for (const e of source?.entries || [])
        db.prepare(
          "INSERT INTO timetable_entries(version_id,day,period,subject_id,faculty_id,start,end,room) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          created,
          e.day,
          e.period,
          e.subject_id,
          e.faculty_id,
          e.start,
          e.end,
          e.room,
        );
      audit(db, req.user, "timetable.create", created, b);
    });
    res.json({ id: created });
  });
  app.put("/api/timetables/:id", admin, (req, res) => {
    const b = z
      .object({
        revision: z.number().int(),
        effective_from: date,
        effective_to: date,
        config: configSchema,
        entries: z.array(entry).max(140),
      })
      .parse(req.body);
    transaction(db, () => {
      const v = version(db, req.params.id);
      if (v.state !== "draft" || v.revision !== b.revision)
        fail(
          409,
          "This version is published or has changed. Reload before editing.",
        );
      if (b.effective_to < b.effective_from)
        fail(400, "Invalid effective range.");
      dates(b.effective_from, b.effective_to);
      validateConfig(b.config);
      const next = { ...v, ...b };
      for (const e of b.entries) validateEntry(db, e, next);
      if (
        new Set(b.entries.map((e) => `${e.day}:${e.period}`)).size !==
        b.entries.length
      )
        fail(400, "A class period can contain only one session.");
      for (let i = 0; i < b.entries.length; i++)
        for (let j = 0; j < i; j++) {
          const a = b.entries[i],
            c = b.entries[j];
          if (a.day === c.day && a.start < c.end && c.start < a.end)
            fail(400, "Two class sessions overlap.");
        }
      db.prepare("DELETE FROM timetable_entries WHERE version_id=?").run(v.id);
      for (const e of b.entries)
        db.prepare(
          "INSERT INTO timetable_entries(version_id,day,period,subject_id,faculty_id,start,end,room) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          v.id,
          e.day,
          e.period,
          e.subject_id,
          e.faculty_id,
          e.start,
          e.end,
          e.room,
        );
      db.prepare(
        "UPDATE timetable_versions SET effective_from=?,effective_to=?,config=?,revision=revision+1 WHERE id=?",
      ).run(b.effective_from, b.effective_to, JSON.stringify(b.config), v.id);
      audit(db, req.user, "timetable.draft_save", v.id, b);
    });
    res.json(version(db, req.params.id));
  });
  app.post("/api/timetables/:id/preview", admin, (req, res) => {
    const v = version(db, req.params.id);
    if (v.state !== "draft")
      fail(400, "Only drafts can be previewed for publication.");
    const p = publicationPlan(db, v);
    res.json({
      version: v,
      summary: p.summary,
      errors: p.errors,
      sessions: p.added.slice(0, 100),
    });
  });
  app.post("/api/timetables/:id/publish", admin, (req, res) => {
    transaction(db, () => {
      const v = version(db, req.params.id);
      if (
        v.state !== "draft" ||
        v.revision !== z.number().int().parse(req.body.revision)
      )
        fail(
          409,
          "Timetable has changed or is already published. Reload and review it.",
        );
      const p = publicationPlan(db, v);
      if (p.errors.length) fail(409, p.errors.join(" "));
      for (const s of p.removed)
        db.prepare(
          "UPDATE scheduled_sessions SET state='superseded',revision=revision+1,reason='Recurring timetable revised' WHERE id=?",
        ).run(s.id);
      const revised = db
        .prepare(
          "SELECT id FROM timetable_versions WHERE class_id=? AND state='published' AND effective_from<=? AND effective_to>=?",
        )
        .get(v.class_id, v.effective_to, v.effective_from);
      for (const s of p.added)
        insertSession(db, {
          ...s,
          reason: revised ? "Published timetable revised" : "",
        });
      db.prepare(
        "UPDATE timetable_versions SET state='published',published_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?",
      ).run(v.id);
      audit(db, req.user, "timetable.publish", v.id, {
        ...p.summary,
        effective_from: v.effective_from,
        effective_to: v.effective_to,
      });
    });
    res.json(version(db, req.params.id));
  });
  app.get("/api/schedule", (req, res) => {
    const from = date.parse(req.query.from || today()),
      to = date.parse(req.query.to || from);
    if (to < from || dates(from, to).length > 62)
      fail(400, "Request at most 62 days.");
    let sessions = db
      .prepare(
        joined +
          " WHERE s.date BETWEEN ? AND ? AND s.state!='superseded' ORDER BY s.date,s.start,s.id",
      )
      .all(from, to);
    if (req.user.role === "student") {
      const st = db
        .prepare("SELECT class_id FROM students WHERE id=?")
        .get(req.user.student_id);
      sessions = sessions.filter((s) => s.class_id === st?.class_id);
    } else if (req.user.role === "teacher")
      sessions = sessions.filter((s) => s.faculty_id === req.user.id);
    else if (!isAdmin(req.user))
      fail(
        403,
        "Timetables are available to students, faculty and administrators.",
      );
    if (req.query.class_id)
      sessions = sessions.filter(
        (s) => s.class_id === id.parse(req.query.class_id),
      );
    res.json({
      sessions: sessions.map((s) => ({
        ...s,
        holiday: !s.holiday_override ? holidayFor(db, s)?.title : null,
        revised: s.change_type !== "standard" || !!s.reason,
      })),
      timezone: "Asia/Kolkata",
    });
  });
  app.post("/api/schedule/:id/attendance", (req, res) => {
    let result;
    transaction(db, () => {
      const s = scheduledAccess(db, req.user, req.params.id, true);
      let t = db
        .prepare("SELECT * FROM teaching_sessions WHERE scheduled_session_id=?")
        .get(s.id);
      if (!t) {
        if (
          db
            .prepare(
              "SELECT id FROM teaching_sessions WHERE subject_id=? AND date=? AND period=?",
            )
            .get(s.subject_id, s.date, s.period)
        )
          fail(
            409,
            "A legacy register already occupies this subject/date/period. Ask an administrator to resolve the schedule.",
          );
        const tid = db
          .prepare(
            "INSERT INTO teaching_sessions(subject_id,date,period,scheduled_session_id) VALUES(?,?,?,?)",
          )
          .run(s.subject_id, s.date, s.period, s.id).lastInsertRowid;
        t = db.prepare("SELECT * FROM teaching_sessions WHERE id=?").get(tid);
        audit(db, req.user, "session.scheduled_create", tid, {
          scheduled_session_id: s.id,
        });
      }
      result = {
        ...s,
        attendance_id: t.id,
        subject_record: db
          .prepare(
            "SELECT s.*,u.name AS teacher FROM subjects s LEFT JOIN users u ON u.id=s.teacher_id WHERE s.id=?",
          )
          .get(s.subject_id),
        class_record: db
          .prepare(
            "SELECT c.*,co.code AS course FROM classes c JOIN courses co ON co.id=c.course_id WHERE c.id=?",
          )
          .get(s.class_id),
      };
    });
    res.json(result);
  });
  const exception = z.object({
    revision: z.number().int().optional(),
    class_id: id,
    subject_id: id,
    faculty_id: id,
    date,
    period: z.number().int().min(1).max(20),
    start: time,
    end: time,
    room: z.string().trim().max(100).default(""),
    state: z.enum(["scheduled", "cancelled"]).default("scheduled"),
    holiday_override: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  });
  const saveException = (req, res) => {
    const b = exception.parse(req.body);
    let result;
    transaction(db, () => {
      const old = req.params.id
        ? scheduledAccess(db, req.user, req.params.id)
        : null;
      if (old && (old.revision !== b.revision || old.state === "superseded"))
        fail(409, "This session changed. Reload before editing.");
      if (old && old.class_id !== b.class_id)
        fail(400, "Cannot move an occurrence to another class.");
      if ((old?.date || b.date) < today())
        fail(
          400,
          "Past scheduled occurrences are immutable. Use the attendance correction workflow.",
        );
      const cls = db
        .prepare("SELECT * FROM classes WHERE id=?")
        .get(b.class_id);
      if (!cls) fail(400, "Class not found.");
      validateEntry(
        db,
        b,
        {
          class_id: b.class_id,
          semester: old
            ? db
                .prepare("SELECT semester FROM subjects WHERE id=?")
                .get(old.subject_id).semester
            : cls.semester,
        },
        true,
      );
      if (b.date < today())
        fail(400, "Cannot schedule an occurrence in the past.");
      if (!b.holiday_override && holidayFor(db, b) && b.state !== "cancelled")
        fail(
          400,
          "This date is a holiday. Explicitly authorize a special working session to proceed.",
        );
      if (
        old?.attendance_id &&
        b.state !== "cancelled" &&
        (!same(old, b) || old.state === "cancelled")
      )
        fail(
          409,
          "Attendance already exists. Preserve this occurrence and create an extra class instead.",
        );
      if (b.state === "scheduled") {
        for (const other of db
          .prepare(
            joined + " WHERE s.date=? AND s.state='scheduled' AND s.id!=?",
          )
          .all(b.date, old?.id || 0)) {
          if (!other.holiday_override && holidayFor(db, other)) continue;
          const error = collision(db, b, other);
          if (error) fail(409, error);
        }
        if (
          db
            .prepare(
              "SELECT id FROM teaching_sessions WHERE subject_id=? AND date=? AND period=? AND (scheduled_session_id IS NULL OR scheduled_session_id!=?)",
            )
            .get(b.subject_id, b.date, b.period, old?.id || 0)
        )
          fail(
            409,
            "An attendance register already occupies this subject, date and period.",
          );
      }
      const change_type = !old
        ? "extra"
        : b.state === "cancelled"
          ? "cancelled"
          : old.date !== b.date ||
              old.start !== b.start ||
              old.period !== b.period
            ? "rescheduled"
            : old.subject_id !== b.subject_id
              ? "subject_change"
              : old.faculty_id !== b.faculty_id
                ? "substitute"
                : "revised";
      if (old) {
        db.prepare(
          "UPDATE scheduled_sessions SET subject_id=?,faculty_id=?,date=?,period=?,start=?,end=?,room=?,state=?,change_type=?,holiday_override=?,reason=?,revision=revision+1 WHERE id=?",
        ).run(
          b.subject_id,
          b.faculty_id,
          b.date,
          b.period,
          b.start,
          b.end,
          b.room,
          b.state,
          change_type,
          +b.holiday_override,
          b.reason,
          old.id,
        );
        result = old.id;
        if (b.state === "cancelled" && old.attendance_id) {
          db.prepare(
            "UPDATE teaching_sessions SET state='cancelled',revision=revision+1 WHERE id=?",
          ).run(old.attendance_id);
          db.prepare(
            "UPDATE jobs SET status='cancelled' WHERE status IN ('pending','retry') AND dedupe_key LIKE ?",
          ).run(`absence:${old.attendance_id}:%`);
          audit(db, req.user, "attendance.schedule_cancel", old.attendance_id, {
            reason: b.reason,
          });
        }
      } else {
        if (b.state !== "scheduled")
          fail(400, "An extra class must initially be scheduled.");
        result = insertSession(db, { ...b, change_type });
      }
      audit(db, req.user, "schedule.exception", result, {
        before: old,
        after: b,
        change_type,
      });
    });
    res.json({ id: result });
  };
  app.post("/api/schedule", admin, saveException);
  app.put("/api/schedule/:id", admin, saveException);
}
