// Self-healing check for the adasos-web PM2 process, meant to run
// periodically (see the "ADASOS-PM2-Watchdog" Scheduled Task set up
// alongside this script -- ../RUN_GUIDE.md documents it).
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
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PM2_HOME = process.env.PM2_HOME || "C:\\Users\\OMMEKA~1\\.pm2";
const PM2_ENV = { ...process.env, PM2_HOME };
const APP_NAME = "adasos-web";
const PORT = 3000;
const PORT_CHECK_TIMEOUT_MS = 3000;

function log(message) {
  console.log(`${new Date().toISOString()} [pm2-watchdog] ${message}`);
}

// STALE-STATUS INCIDENT (2026-09-09): pm2 jlist reported adasos-web as
// status:"online" continuously for over a day (this watchdog logging
// "already online -- nothing to do" every 5 minutes the whole time) while
// the actual OS process (pm2_env._tree_pids) no longer existed and
// localhost:3000 had been refusing connections since a crash-loop on
// 2026-09-08 -- PM2's own Windows process-death detection lost track of the
// child without ever flipping its recorded status. Trusting `pm2 jlist`
// alone is therefore not sufficient evidence of real liveness; confirm
// independently with an actual TCP probe against the port the app is
// supposed to be serving, exactly like health-check.mjs's own port check.
function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1", timeout: PORT_CHECK_TIMEOUT_MS });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
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

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Real boot times observed in ../.pm2/out.log range from ~3s to ~27s
// ("Ready in Xs"), so a post-recovery recheck needs enough headroom to not
// falsely report failure while next dev is still compiling.
const BOOT_GRACE_MS = 15000;

async function isOnline() {
  const proc = pm2(["jlist"]);
  if (proc.status !== 0 || !proc.stdout) {
    return { online: false, stale: false, reason: `pm2 jlist failed: ${proc.stderr?.trim() || "no output"}` };
  }
  let apps;
  try {
    apps = JSON.parse(proc.stdout);
  } catch {
    return { online: false, stale: false, reason: "could not parse pm2 jlist output" };
  }
  const app = apps.find((a) => a.name === APP_NAME);
  if (!app) return { online: false, stale: false, reason: "not registered with PM2" };
  const status = app.pm2_env?.status;
  if (status !== "online") {
    return { online: false, stale: false, reason: `status=${status}` };
  }
  // pm2 jlist alone is not sufficient evidence -- see the stale-status
  // incident note above this function. Confirm the port is real too.
  const portOk = await isPortListening(PORT);
  if (!portOk) {
    return { online: false, stale: true, reason: `pm2 reports status=online but port ${PORT} refused a connection -- stale PM2 state, the underlying process is gone` };
  }
  return { online: true, stale: false, reason: `status=online, port ${PORT} responding` };
}

const before = await isOnline();
if (before.online) {
  log(`${APP_NAME} already online -- nothing to do.`);
  process.exit(0);
}

log(`${APP_NAME} not truly online (${before.reason}).`);

if (before.stale) {
  // A plain `pm2 start` on an entry PM2 already believes is running either
  // no-ops or errors ("already launched") instead of actually reviving the
  // dead process -- `pm2 restart` is the command that unconditionally
  // stops+starts an existing entry regardless of its believed status.
  log("Attempting pm2 restart (PM2 already has this app registered, just pointing at a dead process)...");
  const restart = pm2(["restart", APP_NAME]);
  log(restart.stdout?.trim() || restart.stderr?.trim() || "(no output)");
  await sleepMs(BOOT_GRACE_MS);
  const afterRestart = await isOnline();
  if (afterRestart.online) {
    log(`Recovered ${APP_NAME} via pm2 restart.`);
    process.exit(0);
  }
  log(`pm2 restart did not bring ${APP_NAME} online (${afterRestart.reason}). Deleting the stale entry before starting fresh...`);
  const del = pm2(["delete", APP_NAME]);
  log(del.stdout?.trim() || del.stderr?.trim() || "(no output)");
} else {
  log("Attempting pm2 resurrect...");
  const resurrect = pm2(["resurrect"]);
  log(resurrect.stdout?.trim() || resurrect.stderr?.trim() || "(no output)");
  await sleepMs(BOOT_GRACE_MS);
  const afterResurrect = await isOnline();
  if (afterResurrect.online) {
    log(`Recovered ${APP_NAME} via pm2 resurrect.`);
    process.exit(0);
  }
  log(`resurrect did not bring ${APP_NAME} online (${afterResurrect.reason}).`);
}

// dump.pm2 missing/stale, resurrect didn't help, or restart couldn't revive
// a stale entry -- fall back to starting the app fresh from its own
// ecosystem config.
log("Starting fresh from ecosystem.config.cjs...");
const start = pm2(["start", "ecosystem.config.cjs"]);
log(start.stdout?.trim() || start.stderr?.trim() || "(no output)");
await sleepMs(BOOT_GRACE_MS);

const afterStart = await isOnline();
if (afterStart.online) {
  log(`Recovered ${APP_NAME} via fresh pm2 start.`);
  process.exit(0);
}

log(`FAILED to recover ${APP_NAME} (${afterStart.reason}). Manual intervention needed -- see ../RUN_GUIDE.md.`);
process.exit(1);
