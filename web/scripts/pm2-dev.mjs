// Entry point for the "adasos-web" PM2 process (see ../ecosystem.config.cjs).
//
// Deliberately does NOT shell out to `npm run dev`: PM2 on Windows executes
// a process's `script` directly with node, and npm's own launcher
// (npm.cmd) is a batch file, not JS, so PM2 can't run it. Instead this
// spawns the prepare-backend step and the `next` binary's JS entry point
// directly, sidestepping npm/cmd entirely.
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptsDir, "..");
const PORT = 3000;

// next dev has no "fail if the port is taken" mode -- left alone, it silently
// falls back to 3001+ and PM2 still reports the app "online" (it didn't
// crash, it just isn't on :3000 anymore), so nothing else in this reliability
// chain would ever notice. Confirmed by direct testing: occupying :3000 with
// an unrelated process before a resurrect left adasos-web happily "online"
// on :3001 while :3000 kept serving the other process. See RUN_GUIDE.md.
function findPortHolderPid(port) {
  const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", shell: true });
  if (result.status !== 0 || !result.stdout) return null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.includes(`:${port} `) && line.includes("LISTENING")) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) return pid;
    }
  }
  return null;
}

function commandLineOf(pid) {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
    { encoding: "utf8" }
  );
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function ensurePortFree(port) {
  const pid = findPortHolderPid(port);
  if (!pid) return;

  const cmdLine = commandLineOf(pid);
  const isOwnOrphan = cmdLine.toLowerCase().includes(webRoot.toLowerCase()) && /next/i.test(cmdLine);

  if (isOwnOrphan) {
    console.log(`[pm2-dev] Port ${port} is held by a stale adasos-web process (pid ${pid}) -- killing it and continuing.`);
    spawnSync("taskkill", ["/PID", pid, "/F"], { shell: true });
    return;
  }

  console.error(
    `[pm2-dev] FATAL: port ${port} is held by an unrelated process (pid ${pid}) and refusing to guess.\n` +
      `  Command line: ${cmdLine || "(could not be read)"}\n` +
      `  Stop that process (or change the app's port) before restarting adasos-web --\n` +
      `  proceeding would let Next.js silently fall back to another port while this\n` +
      `  process still reports "online", masking the real problem. See RUN_GUIDE.md.`
  );
  process.exit(1);
}

ensurePortFree(PORT);

const prepare = spawnSync(process.execPath, [path.join(scriptsDir, "prepare-backend.mjs")], {
  cwd: webRoot,
  stdio: "inherit",
});
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev"], {
  cwd: webRoot,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
