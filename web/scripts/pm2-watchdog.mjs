// Self-healing check for the adasos-web PM2 process, meant to run
// periodically (see the "ADASOS-PM2-Watchdog" Scheduled Task set up
// alongside this script -- RUN_GUIDE.md documents it).
//
// Why this exists: pm2-windows-startup registers a `HKCU\...\Run` entry,
// which Windows only fires on interactive logon -- i.e. a real reboot or a
// fresh sign-in. It does NOT fire when a laptop resumes from sleep (lid
// close/reopen), because Windows treats resume-from-sleep as continuing the
// existing logon session, not a new one. A laptop that sleeps overnight and
// has its Node/PM2 processes reaped by the OS during that sleep cycle (seen
// in production: PM2's daemon log shows a brand-new daemon starting at wake
// time with no resurrect ever attempted, while `dump.pm2` still held a
// perfectly valid, restorable snapshot) never gets adasos-web back, and
// http://localhost:3000 refuses to connect until someone notices and runs
// `pm2 resurrect` by hand. This script is that manual step, automated and
// run on a timer so the gap self-heals instead of waiting for the user to
// notice.
//
// Deliberately conservative: only acts when adasos-web is actually absent
// or not online. Never touches a healthy process, never restarts anything
// that's already running fine (so it can safely run every few minutes
// without interfering with normal restarts done via `pm2 restart`).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PM2_HOME = process.env.PM2_HOME || "C:\\Users\\OMMEKA~1\\.pm2";
const PM2_ENV = { ...process.env, PM2_HOME };
const APP_NAME = "adasos-web";

function log(message) {
  console.log(`${new Date().toISOString()} [pm2-watchdog] ${message}`);
}

// Confirmed by direct testing (real `schtasks /run`, not simulated): the
// Scheduled Task's process cannot see anything under
// C:\Users\...\AppData\Roaming at all -- not just the global `pm2` shim
// there, but even a plain `cmd.exe /c dir` on that path failed with "The
// system cannot find the path specified.", while the project's own
// Desktop-tree path resolved fine in the same run. A real, narrow Windows
// access-boundary difference between the task's S4U logon and an
// interactive one -- not fixable by path-quoting tweaks, only by avoiding
// AppData\Roaming entirely. So: call node.exe directly (full path, no PATH
// lookup, no shell) against pm2's real JS entry point in web's own local
// `pm2` devDependency (web/node_modules/pm2), never the global npm install.
const NODE_EXE = process.env.WATCHDOG_NODE_EXE || "C:\\Program Files\\nodejs\\node.exe";
const PM2_JS_BIN = process.env.PM2_JS_BIN || path.join(webRoot, "node_modules", "pm2", "bin", "pm2");
if (!existsSync(PM2_JS_BIN)) log(`WARNING: PM2_JS_BIN does not exist at ${PM2_JS_BIN} -- pm2 calls will fail.`);

function pm2(args) {
  return spawnSync(NODE_EXE, [PM2_JS_BIN, ...args], { cwd: webRoot, env: PM2_ENV, encoding: "utf8" });
}

function isOnline() {
  const proc = pm2(["jlist"]);
  if (proc.status !== 0 || !proc.stdout) {
    return { online: false, reason: `pm2 jlist failed: ${proc.stderr?.trim() || "no output"}` };
  }
  let apps;
  try {
    apps = JSON.parse(proc.stdout);
  } catch {
    return { online: false, reason: "could not parse pm2 jlist output" };
  }
  const app = apps.find((a) => a.name === APP_NAME);
  if (!app) return { online: false, reason: "not registered with PM2" };
  const status = app.pm2_env?.status;
  return { online: status === "online", reason: `status=${status}` };
}

const before = isOnline();
if (before.online) {
  log(`${APP_NAME} already online -- nothing to do.`);
  process.exit(0);
}

log(`${APP_NAME} not online (${before.reason}). Attempting pm2 resurrect...`);
const resurrect = pm2(["resurrect"]);
log(resurrect.stdout?.trim() || resurrect.stderr?.trim() || "(no output)");

const afterResurrect = isOnline();
if (afterResurrect.online) {
  log(`Recovered ${APP_NAME} via pm2 resurrect.`);
  process.exit(0);
}

// dump.pm2 missing/stale, or resurrect otherwise didn't bring it back --
// fall back to starting the app fresh from its own ecosystem config.
log(`resurrect did not bring ${APP_NAME} online (${afterResurrect.reason}). Starting fresh from ecosystem.config.cjs...`);
const start = pm2(["start", "ecosystem.config.cjs"]);
log(start.stdout?.trim() || start.stderr?.trim() || "(no output)");

const afterStart = isOnline();
if (afterStart.online) {
  log(`Recovered ${APP_NAME} via fresh pm2 start.`);
  process.exit(0);
}

log(`FAILED to recover ${APP_NAME} (${afterStart.reason}). Manual intervention needed -- see RUN_GUIDE.md.`);
process.exit(1);
