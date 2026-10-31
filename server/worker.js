import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openDatabase, transaction } from "./db.js";
if (existsSync(".env")) process.loadEnvFile(".env");

export async function processJob(db, send, mode = "dry-run") {
  const job = transaction(db, () => {
    // Ambiguous sends require review: never blindly retry a request that may have reached Meta.
    db.prepare(
      "UPDATE jobs SET status='needs_review',last_error='Worker stopped during send; check provider before retrying.' WHERE status='processing' AND locked_at<?",
    ).run(Date.now() - 120000);
    const job = db
      .prepare(
        "SELECT * FROM jobs WHERE status IN ('pending','retry') AND next_attempt<=? ORDER BY id LIMIT 1",
      )
      .get(Date.now());
    if (job)
      db.prepare(
        "UPDATE jobs SET status='processing',locked_at=?,attempts=attempts+1 WHERE id=?",
      ).run(Date.now(), job.id);
    return job;
  });
  if (!job) return false;
  const student = db
      .prepare("SELECT * FROM students WHERE id=?")
      .get(job.student_id),
    payload = JSON.parse(job.payload);
  if (!student?.whatsapp_consent || !student.notification_phone) {
    db.prepare(
      "UPDATE jobs SET status='cancelled',last_error='Recipient has not opted in.' WHERE id=?",
    ).run(job.id);
    return true;
  }
  if (job.kind === "absence") {
    const session = db
      .prepare(
        "SELECT t.state,t.revision,m.status FROM teaching_sessions t LEFT JOIN marks m ON m.session_id=t.id AND m.student_id=? WHERE t.id=?",
      )
      .get(job.student_id, payload.session_id);
    if (
      !session ||
      session.state !== "submitted" ||
      session.revision !== payload.revision ||
      session.status !== "A"
    ) {
      db.prepare(
        "UPDATE jobs SET status='cancelled',last_error='Attendance changed before delivery.' WHERE id=?",
      ).run(job.id);
      return true;
    }
  }
  if (mode !== "live") {
    db.prepare(
      "UPDATE jobs SET status='dry_run',last_error='No message sent: dry-run mode.' WHERE id=?",
    ).run(job.id);
    return true;
  }
  try {
    const providerId = await send(student.notification_phone, payload.message);
    db.prepare(
      "UPDATE jobs SET status='sent',provider_id=?,last_error='' WHERE id=?",
    ).run(providerId, job.id);
  } catch (e) {
    const retry = e.retryable && job.attempts < 4;
    db.prepare(
      "UPDATE jobs SET status=?,last_error=?,next_attempt=? WHERE id=?",
    ).run(
      retry ? "retry" : e.ambiguous ? "needs_review" : "failed",
      e.safeMessage || "Provider request failed. Check worker configuration.",
      Date.now() + 60000 * 2 ** job.attempts,
      job.id,
    );
  }
  return true;
}
async function sendWhatsApp(phone, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN,
    phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID,
    version = process.env.WHATSAPP_GRAPH_VERSION,
    template = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!token || !phoneId || !version || !template)
    throw Object.assign(new Error("Missing config"), {
      safeMessage: "WhatsApp configuration is incomplete.",
    });
  let response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${version}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace("+", ""),
          type: "template",
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
            components: [
              { type: "body", parameters: [{ type: "text", text: message }] },
            ],
          },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch (e) {
    throw Object.assign(new Error("Network failure"), {
      ambiguous: true,
      safeMessage: "Network outcome unknown; verify provider before retrying.",
    });
  }
  if (!response.ok)
    throw Object.assign(new Error("Provider error"), {
      retryable: response.status === 429,
      safeMessage: `WhatsApp returned HTTP ${response.status}.`,
    });
  const body = await response.json();
  if (!body.messages?.[0]?.id)
    throw Object.assign(new Error("Unknown response"), {
      ambiguous: true,
      safeMessage: "Provider response has no message ID; verify delivery.",
    });
  return body.messages[0].id;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = openDatabase();
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      stopping = true;
    });
  console.log(
    `Notification worker started (${process.env.WHATSAPP_MODE || "dry-run"}).`,
  );
  while (!stopping) {
    try {
      await processJob(
        db,
        sendWhatsApp,
        process.env.WHATSAPP_MODE || "dry-run",
      );
    } catch (e) {
      console.error("Worker tick failed:", e.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  db.close();
}
