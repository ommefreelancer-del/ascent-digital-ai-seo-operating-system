// Standalone operational health check for the adasos-web PM2 process.
// Does not touch application code -- reads PM2 state, probes the port,
// opens the SQLite DB read-only, and checks .env for required keys.
// Run with: node scripts/health-check.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Registered as a persistent user env var (see ../RUN_GUIDE.md); falls back to
// the space-free 8.3 short path in case this script runs before the
// registry value has propagated to the current session.
const PM2_HOME = process.env.PM2_HOME || "C:\\Users\\OMMEKA~1\\.pm2";
const PM2_ENV = { ...process.env, PM2_HOME };

const APP_NAME = "adasos-web";
const PORT = 3000;
const REQUIRED_ENV_KEYS = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "ANTHROPIC_API_KEY"];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

// 1 + 2. PM2 daemon reachable, and adasos-web online
function checkPm2() {
  const proc = spawnSync("pm2", ["jlist"], { env: PM2_ENV, shell: true, encoding: "utf8" });
  if (proc.status !== 0 || !proc.stdout) {
    record("PM2 daemon running", false, proc.stderr?.trim() || "pm2 jlist failed");
    record(`${APP_NAME} process online`, false, "skipped -- PM2 unreachable");
    return;
  }
  record("PM2 daemon running", true, `PM2_HOME=${PM2_HOME}`);

  let apps;
  try {
    apps = JSON.parse(proc.stdout);
  } catch {
    record(`${APP_NAME} process online`, false, "could not parse pm2 jlist output");
    return;
  }
  const app = apps.find((a) => a.name === APP_NAME);
  if (!app) {
    record(`${APP_NAME} process online`, false, "not registered with PM2 -- run: pm2 start ecosystem.config.cjs");
  } else {
    const status = app.pm2_env?.status;
    record(`${APP_NAME} process online`, status === "online", `status=${status}, restarts=${app.pm2_env?.restart_time ?? "?"}`);
  }
}

// 3. Port 3000 listening
function checkPort() {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: "127.0.0.1", timeout: 2000 });
    socket.on("connect", () => {
      record(`Port ${PORT} listening`, true, "TCP connect succeeded");
      socket.destroy();
      resolve();
    });
    socket.on("error", (err) => {
      record(`Port ${PORT} listening`, false, err.message);
      resolve();
    });
    socket.on("timeout", () => {
      record(`Port ${PORT} listening`, false, "connection timed out");
      socket.destroy();
      resolve();
    });
  });
}

// 4. Database accessible
function checkDatabase() {
  const dbPath = path.join(webRoot, "prisma", "prisma", "dev.db");
  if (!existsSync(dbPath)) {
    record("Database accessible", false, `not found at ${dbPath}`);
    return;
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const check = db.prepare("PRAGMA quick_check").get();
    const tableCount = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get();
    db.close();
    record("Database accessible", check.quick_check === "ok", `quick_check=${check.quick_check}, tables=${tableCount.n}`);
  } catch (err) {
    record("Database accessible", false, err.message);
  }
}

// 5. Required environment variables present in web/.env
function checkEnvFile() {
  const envPath = path.join(webRoot, ".env");
  if (!existsSync(envPath)) {
    record("Environment variables present", false, `${envPath} not found`);
    return;
  }
  const contents = readFileSync(envPath, "utf8");
  const present = new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .filter((m) => m[2].trim().length > 0)
      .map((m) => m[1])
  );
  const missing = REQUIRED_ENV_KEYS.filter((k) => !present.has(k));
  record("Environment variables present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `all ${REQUIRED_ENV_KEYS.length} required keys set`);
}

// 6. The ADASOS-PM2-Watchdog scheduled task exists and can't be silently
// neutered by running on battery -- see install-watchdog-task.ps1 for why
// this exact condition caused every previous "fix" to regress after a
// reboot: Windows Task Scheduler's DisallowStartIfOnBatteries/
// StopIfGoingOnBatteries default to true, which skips every firing on a
// laptop running on battery power with no error and no log line, while
// `schtasks /query` still happily reports the task as "Ready"/"Enabled".
function checkWatchdogTask() {
  const proc = spawnSync("schtasks", ["/query", "/tn", "ADASOS-PM2-Watchdog", "/xml"], { encoding: "utf8", shell: true });
  if (proc.status !== 0 || !proc.stdout) {
    record(
      "Watchdog scheduled task installed",
      false,
      "ADASOS-PM2-Watchdog not found -- run: powershell -File scripts/install-watchdog-task.ps1"
    );
    return;
  }
  const xml = proc.stdout;
  const disallowOnBatteries = /<DisallowStartIfOnBatteries>true<\/DisallowStartIfOnBatteries>/i.test(xml);
  const stopOnBatteries = /<StopIfGoingOnBatteries>true<\/StopIfGoingOnBatteries>/i.test(xml);
  const hasLogonTrigger = /<LogonTrigger>/i.test(xml);
  if (disallowOnBatteries || stopOnBatteries) {
    record(
      "Watchdog scheduled task installed",
      false,
      "task exists but will NOT run on battery power (this is the exact bug from ../RUN_GUIDE.md) -- re-run: powershell -File scripts/install-watchdog-task.ps1"
    );
    return;
  }
  record(
    "Watchdog scheduled task installed",
    true,
    hasLogonTrigger ? "battery-independent, fires every 5min + at logon" : "battery-independent (no logon trigger -- recovery may take up to 5min after reboot)"
  );
}

// Bonus end-to-end signal: the app actually serves a request that depends
// on NEXTAUTH_SECRET/NEXTAUTH_URL being loaded correctly at runtime.
async function checkHttp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/auth/session`, { signal: AbortSignal.timeout(3000) });
    record("App responding over HTTP", res.status === 200, `GET /api/auth/session -> ${res.status}`);
  } catch (err) {
    record("App responding over HTTP", false, err.message);
  }
}

checkPm2();
await checkPort();
checkDatabase();
checkEnvFile();
checkWatchdogTask();
await checkHttp();

console.log("\nADASOS Health Check\n" + "=".repeat(40));
let allOk = true;
for (const r of results) {
  if (!r.ok) allOk = false;
  console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` -- ${r.detail}` : ""}`);
}
console.log("=".repeat(40));
console.log(allOk ? "Overall: HEALTHY" : "Overall: UNHEALTHY");
process.exit(allOk ? 0 : 1);
