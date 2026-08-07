# ADASOS — Daily Run Guide

How to start and use the app locally, every day.

## Launch it

### Option A — VS Code (recommended)
This repo has `.claude/launch.json` pre-configured with a task named **adasos-web**.
If you're using the Claude Code extension/CLI in VS Code, just start the `adasos-web`
launch config and it opens `http://localhost:3000` automatically.

### Option B — plain terminal
```bash
cd "web"
npm run dev
```
Then open **http://localhost:3000** in your browser.

That's it — `npm run dev` automatically:
- Rebuilds the backend (`../dist`) only if it's missing (skips otherwise, so startup is fast).
- Starts Next.js on port 3000.

## Sign in

- Go to `http://localhost:3000` (redirects to `/login`).
- Use your existing account, or click **Create one** to register a new local account
  (accounts are stored in the local SQLite DB at `web/prisma/dev.db`).

## Stopping it

Press `Ctrl+C` in the terminal running `npm run dev` (or stop the VS Code launch task).
If it's running under PM2 (see below), use `pm2 stop adasos-web` instead.

## Where things live

| Thing | Location |
|---|---|
| Frontend (Next.js app you use daily) | `web/` |
| Backend agent logic (frozen, compiled) | `src/` → compiled to `dist/` |
| Local database | `web/prisma/prisma/dev.db` (SQLite) |
| Environment config | `web/.env` |

## Permanent setup: PM2 as a persistent daemon

ADASOS runs as a PM2-managed process (`adasos-web`, defined in `web/ecosystem.config.cjs`)
so it survives terminal closures, VS Code restarts, and now — Windows reboots.

- **PM2_HOME**: set to `C:\Users\OMMEKA~1\.pm2` (the space-free 8.3 short path for this
  user's profile folder). PM2 on Windows does not correctly quote paths containing
  spaces when installing modules, so the default `%USERPROFILE%\.pm2` breaks
  `pm2 install`. This is a persistent **user environment variable** — new terminals and
  logon sessions pick it up automatically; if a shell was open before it was set, close
  and reopen it.
- **Auto-restart on crash**: already configured in `ecosystem.config.cjs`
  (`autorestart: true`, `max_restarts: 10`, `min_uptime: "10s"`) — PM2 restarts the app
  immediately on crash, and resets its restart counter once the app has been stable for
  10s, so this doesn't cap restarts over the app's lifetime, only crash-loops.
- **Auto-start on Windows boot**: `pm2-windows-startup` is installed globally and
  registered under `HKCU\...\Run` (fires at this Windows user's logon — Windows has no
  native PM2 service, so this is the standard approach). It silently runs
  `pm2 resurrect`, which restores whatever was saved with `pm2 save` — currently
  `adasos-web` + the `pm2-logrotate` module. **This path is unverifiable in
  practice** — `invisible.vbs` launches it hidden and fire-and-forget (no stdout/stderr
  capture, no log file anywhere), so if it fails there's no way to know. Treat it as a
  bonus, not the mechanism this setup actually depends on — that's the watchdog below.
  - **This only covers a real reboot/fresh sign-in, not resuming from sleep.** A
    `HKCU\...\Run` entry fires on interactive logon only — Windows does not re-run it
    when a laptop wakes from sleep (lid close/reopen), because that resumes the
    existing logon session rather than starting a new one. In production this showed
    up as: laptop closed and reopened, `http://localhost:3000` refused to connect, and
    PM2's own daemon log showed a brand-new daemon starting at wake time with no
    resurrect ever attempted — even though `dump.pm2` still had a perfectly valid,
    restorable snapshot the whole time.
  - **The fix**: the **`ADASOS-PM2-Watchdog`** Scheduled Task (`web/scripts/run-watchdog.cmd`
    → `web/scripts/pm2-watchdog.mjs`) runs every 5 minutes (plus at logon, as of the fix
    below) and calls `pm2 resurrect` — falling back to `pm2 start ecosystem.config.cjs`
    if the dump is missing/stale — whenever `adasos-web` isn't already online. It's a
    no-op the rest of the time. Inspect it with
    `schtasks /query /tn "ADASOS-PM2-Watchdog" /v /fo list`; logs go to
    `web/.pm2/watchdog.log`.
    - **Why it calls `node.exe` directly against `web/node_modules/pm2/bin/pm2`**,
      instead of the global `pm2` command: confirmed by direct testing, a Scheduled
      Task's process cannot see anything under `%APPDATA%\Roaming` at all (not just the
      global `pm2` shim there — even a plain `dir` on that path failed), while the
      project's own path under `Desktop\...\web` resolves fine in the same run. A real,
      narrow Windows access-boundary difference between the task's logon type and an
      interactive session. If this script is ever changed, keep every path it touches
      under the project directory or the user profile root (like `PM2_HOME` already is)
      — never under `AppData\Roaming`.
  - **The root cause of the recurring "still broken after reboot" reports (fixed
    2026-08-06)**: the Scheduled Task itself was created once, by hand, and never
    captured in a script — so every earlier "fix" to it was undocumented, unreviewable,
    and silently regressed. Direct investigation (comparing `web/.pm2/watchdog.log`
    against `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime` and PM2's own
    daemon log) found the task's XML had
    `DisallowStartIfOnBatteries=true` / `StopIfGoingOnBatteries=true` — Windows Task
    Scheduler's defaults, left unset by the original `schtasks /create`. On a laptop
    that's unplugged more often than not, this **silently skips every single firing** —
    no error, no log line — while `schtasks /query` still happily reports the task as
    "Ready"/"Enabled". This was caught live: the machine was on battery when
    investigated, and the watchdog log showed a 39+ hour gap with zero entries spanning
    an actual reboot, despite being configured to run every 5 minutes forever.
    `adasos-web` was confirmed down and port 3000 confirmed closed at the time.
  - **Permanent fix**: run
    ```bash
    powershell -File web/scripts/install-watchdog-task.ps1
    ```
    This (re)installs the task with `DisallowStartIfOnBatteries=false` /
    `StopIfGoingOnBatteries=false`, plus a logon trigger (scoped to this user's SID —
    an *unscoped* logon trigger needs elevation and fails with "Access is denied" for a
    standard user; a self-scoped one doesn't) for near-instant recovery on a real
    reboot instead of waiting up to 5 minutes. **This script is the source of truth for
    the task's config** — re-run it any time the task is deleted, misconfigured, or
    after a machine migration, instead of recreating it by hand again.
    `npm run health-check` now checks for this exact regression (battery-blocking
    settings) as one of its checks, so it surfaces immediately instead of waiting for
    the next reboot to fail.
  - **After changing anything about the running process list (env vars, new PM2 apps,
    ecosystem.config.cjs changes), run `pm2 save` again** so the next logon or watchdog
    resurrect restores the updated state.
- **Log rotation**: the `pm2-logrotate` module is installed and configured — 10MB max
  file size, 14-day retention, gzip compression, rotates daily at midnight. Inspect with
  `pm2 conf pm2-logrotate`; PM2 log files live under `%PM2_HOME%\logs`.

Useful commands (run from anywhere once `pm2` is on PATH — it's installed globally):
```bash
pm2 list                  # process + module status
pm2 logs adasos-web       # tail live logs
pm2 restart adasos-web    # manual restart
pm2 save                  # persist current process list for next boot
```

## Port drift: the one gap this setup didn't originally catch

`next dev` has no "fail if the port is taken" mode. Confirmed by direct
test: occupying `:3000` with an unrelated process, then resurrecting
`adasos-web`, resulted in Next.js printing `- Local: http://localhost:3001`
while PM2 still reported the app `online` — it didn't crash, it just wasn't
on `:3000` anymore. Nothing in the watchdog or PM2 would ever have flagged
this; you'd get `ERR_CONNECTION_REFUSED` on `:3000` forever while a
perfectly healthy app sat on `:3001`.

**Fixed** in `web/scripts/pm2-dev.mjs` (`ensurePortFree`): before spawning
`next dev`, it checks who holds port 3000. If the holder's command line
points into this project's own `web/` tree (a stale orphan from an earlier
run that treekill missed), it kills it and proceeds. If it's genuinely
unrelated, it refuses to start and writes a clear message to `error.log`
with the offending PID and command line, instead of silently drifting to
another port.

**Validated** with 5 consecutive cold-start cycles (`pm2 kill` → confirm
`:3000` is free → `pm2 resurrect`, the exact command the logon Run-key
fires → poll until a real HTTP response): all 5 reached the app within
~20-23s.

## Git tracking: this whole reliability layer was untracked

As of 2026-08-07, `ecosystem.config.cjs`, every `web/scripts/pm2-*.mjs`,
`install-watchdog-task.ps1`, and `web/.gitignore` itself were all untracked
(`git status` showed `??`). Any `git clean`, fresh clone, or migration to a
new machine would have silently erased this entire reliability layer with
no error — it would just quietly stop existing, which is the most likely
reason earlier fixes here kept regressing: nothing forced the next session
to rediscover *that* this layer even existed, let alone how it worked.
Now committed. If you're reading this after a fresh clone: run
`npm install && node web/scripts/prepare-backend.mjs && cd web && pm2 start
ecosystem.config.cjs && pm2 save`, then
`powershell -File scripts/install-watchdog-task.ps1`, then install
`pm2-windows-startup` globally and run its `pm2-startup install`.

Separately, almost the entire `web/` Next.js application itself (nearly all
of `src/`, `tests/`, `prisma/schema.prisma`, and the config files) was also
untracked — a much bigger gap than just this reliability layer, fixed in
the same pass. See the top-level commit history for details; in short, past
work had only ever `git add`ed a narrow, explicit list of files instead of
the whole tree, so most new frontend code silently never made it into any
commit. While auditing that, a real `.gitignore` bug was also found and
fixed: Prisma resolves a relative sqlite `DATABASE_URL` against
`schema.prisma`'s own directory, not the project root, so
`DATABASE_URL="file:./prisma/dev.db"` with the schema at
`web/prisma/schema.prisma` actually creates `web/prisma/prisma/dev.db` — a
path the old `prisma/dev.db` ignore pattern never matched, leaving the real
local database both untracked *and* un-ignored at the same time.

**To stop this from happening a third time**, a `pre-commit` hook
(`.githooks/pre-commit`) now refuses any commit while untracked files
exist that aren't gitignored — the exact situation that let this drift for
weeks unnoticed. It isn't wired up automatically on a fresh clone (git
doesn't version hook activation, only hook *files*); run this once per
clone:
```bash
git config core.hooksPath .githooks
```

## Health check

```bash
cd web
npm run health-check
```
Checks PM2 daemon reachability, `adasos-web` process status, port 3000, SQLite DB
integrity, required `.env` keys, and a live HTTP request — prints PASS/FAIL per check
and exits non-zero if anything is unhealthy. Script: `web/scripts/health-check.mjs`.

## If something goes wrong

- **Port 3000 already in use**: stop whatever else is on that port, or run
  `PORT=3001 npm run dev` (bash) inside `web/`.
- **Backend changes don't show up**: delete the `dist/` folder at the repo root and
  restart — `predev` will rebuild it automatically.
- **Weird auth/session errors**: delete `web/.next` (build cache) and restart.
- **App not reachable after a reboot or waking from sleep**: run `npm run health-check`
  from `web/` first to see exactly which layer failed, then `pm2 logs adasos-web` for
  details. It should self-heal within 5 minutes via the `ADASOS-PM2-Watchdog` Scheduled
  Task (see above) — check `web/.pm2/watchdog.log` to see whether it ran and what it
  did. To recover immediately without waiting: `pm2 resurrect` (falls back to
  `pm2 start ecosystem.config.cjs` from `web/` if that doesn't bring it back).

## Notes

- This is a local development setup (`next dev`), not a production deployment —
  fine for daily personal use.
- No further setup is needed: dependencies are installed and the Prisma client is
  already generated.
