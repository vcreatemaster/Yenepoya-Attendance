import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const { openDatabase } = await import("./db.js");
const { createApp } = await import("./app.js");
const db = openDatabase();
const port = Number(process.env.PORT || 3001),
  host = process.env.HOST || "127.0.0.1";
const server = createApp(db).listen(port, host, () =>
  console.log(`Yenepoya API listening on http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
