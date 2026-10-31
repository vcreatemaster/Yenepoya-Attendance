# Yenepoya Attendance

A local-first Node.js + React application for university attendance, academic administration, student records, and leave management. Uses Express, React/Vite, and SQLite (Node 24's built-in driver). The standalone notification worker uses a durable SQLite queue.

## Run locally

Requires Node.js 24.13 or later on the Node 24 release line.

```sh
npm install
npm run setup
npm run dev
```

Open **http://localhost:5173**. The API runs on `127.0.0.1:3001`. Initial accounts have unique randomly generated passwords in `.local/credentials.json` (excluded from Git). Login IDs are:

- `admin@yenepoya.local` — master administrator
- `teacher@yenepoya.local` — subject teacher / class advisor
- `welfare@yenepoya.local` — student welfare officer
- `student@yenepoya.local` — fictional student in a separate DEMO class

The provided workbook has already been loaded into the current local database. For a **fresh** database, initialize with the original workbook instead of the generic setup:

```sh
npm run setup -- "/absolute/path/to/Batch 2026- BCA 'A' Attendance Tracker.xlsx"
```

Setup never overwrites an initialized database. Without a workbook it creates clearly labelled example students. It never creates login accounts for real students automatically. Use **Settings & access → Create login** to link a login to a student record.

If your global npm cache has ownership errors, use `npm install --cache .local/npm-cache`. Do not run npm with sudo.

```sh
npm test           # Isolated API, data integrity, permissions, import, and worker tests
npm run build     # Build the React frontend
npm start         # Serve the built app and API at http://127.0.0.1:3001
npm run worker    # Run notification jobs in another terminal (dry-run by default)
```

Copy `.env.example` to `.env` to override settings. `DB_PATH` defaults to `data/attendance.sqlite`. The dev frontend proxies `/api` to port 3001; update `vite.config.js` if changing the API port. For production, use HTTPS, `NODE_ENV=production`, and a reverse proxy preserving the request host. Secure cookies intentionally require HTTPS in production.

## Implemented workflows

- **Academic setup:** multiple courses; admission cohorts and sections (A/B/C); semester-specific subjects; subject teacher and class advisor assignments.
- **Access:** master admin, academic admin, welfare, teacher, and student accounts. Faculty see only their assigned subjects in the register, dashboard, student percentages, and exports, including when another teacher handles a subject in the same class. A class-advisor assignment alone does not grant attendance access. Students can retrieve only their own records. Master admin alone creates academic admins.
- **Staff directory:** unique employee code, name, department, position/designation, login ID, role, active/inactive status, and multiple subject assignments across classes and semesters. Admins can create/edit staff and reset passwords. Staff directory → Import staff provides an Excel template for up to 250 new accounts, including employee_code, name, email, department, position, role, password, and optional comma-separated subject_ids. The template includes current subject IDs and assignments. Passwords accept 8–128 characters and are hashed before storing the preview; neither passwords nor hashes are returned in previews or audit records. Imports validate every row, reject existing accounts and conflicting assignments, and commit all rows together after rechecking conflicts. Preview tokens belong to the uploading administrator, expire after 15 minutes, and can only be committed once. Only master admins can import administrator accounts. Deactivation and password resets revoke all existing sessions. Assignment removals take effect immediately. Updates are audited and protected against stale edits. Existing accounts are preserved by an automatic additive migration; missing employee details are flagged for completion. Master-admin accounts remain protected. A subject has one assigned teacher; reassign an already allocated subject in Academic setup. Student logins are created separately in Settings & access.
- **Attendance:** immersive register with a single scrolling grid, pinned student names and headers, explicit session selection, optional session history, search and unmarked filters, keyboard P/A/L/N entry, up/down navigation, previewed single-column paste, fill-only-unmarked present, undo, unsaved-change guards, draft saving, exception review before submission, formatted Excel export, cancelled sessions, audited administrator corrections, and optimistic revision checks. The Excel register follows the supplied workbook: university logo, class/month/advisor/subject/teacher details, serial numbers, campus IDs, registration numbers, names, day-only date headers, and attendance totals. Export uses the selected month; with the month cleared, each month gets its own worksheet. Full dates, periods and session states are in header cell notes. A hidden calculation row keeps drafts, future and cancelled sessions out of formula-driven percentages.
- **Student import:** downloadable `.xlsx` template, full-file validation, row-level preview, duplicate detection, and transactional create/update by campus ID. Required fields: name, course code, admission year, batch, campus ID. Optional fields include registration number and all requested blood group, address, student and family contact fields. Create academic classes before importing. Existing class transfers are deliberately rejected to protect history. Blank optional cells replace existing values.
- **Student reports:** directory → View report shows current-class subject attendance, filterable and paginated session history, leave dates and decisions, and profile details. Approved leave calendar days count overlapping dates once, including future dates and weekends. Admins can edit student details with stale-edit protection and audit logging; class changes are blocked after attendance exists. Teachers see only their own subjects and no private family details or leave reasons.
- **Student portal:** subject-wise percentages, attended/recorded totals, attendance history, leave requests, and calendar.
- **Leave:** from/to date, category and reason; admin or welfare approval/rejection; mandatory rejection reason; overlapping requests rejected; reviewer and decision history retained.
- **Calendar:** university-wide or class-specific events, examinations, and holidays. New sessions cannot be created on applicable holidays. Adding a holiday does not silently cancel existing sessions: administrators must review them.
- **Reports:** dashboard and below-threshold students, subject attendance export, `/api/reports/export` for a complete CSV summary; configurable attendance threshold.
- **Notifications:** opt-in recipient per student; durable jobs for submitted absences and leave decisions; manually queued daily low-attendance summaries; deduplication, retry on provider rate limiting, and review status for uncertain delivery outcomes. Dry-run is the default.
- **Security:** scrypt password hashes, opaque server-side sessions, HTTP-only cookies, same-origin/header protection for mutations, basic login throttling, request validation, audit records, and server-side role/class/student filtering. Contact fields are limited to administrative and welfare views.

## Workbook findings and migration

Source: `Batch 2026- BCA 'A' Attendance Tracker.xlsx`, worksheet `DL`.

- Header metadata: `A9:D13` identifies I BCA A, August–November 2026, advisor/teacher Karunya Thomas, and Digital Logic and Computer Organization.
- Headers: `A15:D16` contain serial number, campus ID, registration number, and student name. `E15:BP16` contain day/month headers for 64 planned periods. Repeated dates represent separate periods.
- Student rows: 17–75, 59 records. Registration numbers are empty in the supplied sample.
- Recorded marks: 1,456 exact P and 429 A across 32 columns, plus three nonstandard entries: `E45` contains `p`, `R71` contains ` P`, and `M38` contains `P.`. Case and whitespace normalization yields **1,458 present and 429 absent**. The ambiguous `P.` entry is left unmarked in the app for administrator review and its source value is retained in the migration audit. The remaining 32 planned columns have no marks.
- `BQ16 = COUNTA(E16:BP16)` returns 64. `BQ17 = COUNTIF(E17:BP17,"P")` counts 22, and `BR17 = ROUND((BQ17/$BQ$16)*100,0)` displays 34%. This divides by the full plan, not recorded attendance. The app instead gives 22/32 = **68.8%** for that record (rounded to a whole percent in the compact grid).
- Imported marks and dates are preserved in the local database. Dates use 2026, taken from the workbook's explicit period. Repeated dates receive sequential period numbers in sheet order because no timetable period labels are supplied.
- Recorded columns have `imported` status; empty planned columns remain drafts. Historical blanks remain unmarked and require review; they are not silently turned into absences or inferred exemptions. One name contains a joining-date note, which is preserved rather than interpreted as an enrollment policy.
- The original workbook is never changed. The imported student roster, contacts, database files, source workbook, and generated credentials are excluded from Git. The documented example academic structure uses the supplied course, subject, and teacher metadata.

## Attendance rules used in this version

1. Each date + period is a separate subject session.
2. `P` = present, `A` = absent, `L` = late (counts as attended), `N` = not enrolled in that session (excluded).
3. Percentage = `(P + L) / (P + A + L) × 100`, from submitted/imported sessions through today's date in Asia/Kolkata.
4. Blank marks, N, drafts, cancellations, and future sessions never enter the denominator. No records yields no percentage, rather than 0%.
5. All active students must be marked before a normal session can be submitted. Imported historical blanks are preserved as a migration exception.
6. Subject teachers can edit drafts. Submitted/imported/cancelled records require administrator access and a correction reason. Every correction stores previous and new marks.
7. Admin or welfare can make the first leave decision. Approved leave does not automatically count as present or remove an absence.

These are explicit initial assumptions, not a claim about the University's official attendance policy.

## WhatsApp connection

The worker implements Meta's template message format, using an approved template with **one text body parameter** (`{{1}}`). The message text fills that parameter. References: [Meta template messages](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/) and [Meta Cloud API message example](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive).

Configure a supported Graph version, phone number ID, approved template name/language, and access token in `.env`. Enable `WHATSAPP_MODE=live` only when the recipient opt-ins and template are ready. Start the worker separately. There are no live credentials in the repository and no external messages were sent during development.

Use **Students → open a record** to save the preferred international-format phone and explicit consent. Imported parent numbers do not imply consent. Dry-run jobs are recorded as `dry_run` and are not automatically replayed when live mode is enabled. The worker checks consent again immediately before sending.

Provider rate limits are retried with bounded exponential backoff. Network timeouts and stale processing claims become `needs_review`, avoiding automatic duplicate sends after an uncertain outcome. A worker should be supervised and share the application's SQLite file. `sent` means provider accepted, not delivered/read. Failed or ambiguous jobs currently require operator review; there is no automatic replay button.

## Scope and deployment follow-up

This is a working first implementation, with local SQLite storage and a single-campus model. It is not yet a fully operated production service. Before a campus rollout, complete policy review and deployment setup. Not yet implemented: self-service password reset/email delivery, MFA, student account suspension/reset management, leave attachments or half-day leave, timetable scheduling, automatic scheduled summaries, delivery/read webhooks, multiple teachers per subject, enrollment-date-based denominators, promotion/transfer workflows, PDF exports, multiple campuses, and automated backups.

SQLite is suited to this local/single-server version. Do not put the live database on a shared network filesystem or run independently replicated app instances against separate database copies. For multiple servers or high concurrency, migrate storage and job claiming to PostgreSQL/Redis or an equivalent shared service. Back up SQLite with its online backup mechanism or stop all writers before copying the database and its WAL files. The local credential file is for setup handoff only; distribute credentials securely and change initial passwords.

React is served by Express after `npm run build`. API routes are under `/api`; application code is in `server/`, frontend code in `src/`, and isolated automated tests in `tests/`.
