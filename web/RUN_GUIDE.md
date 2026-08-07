# Running adasos-web reliably on Windows

This is the single source of truth for why the dev server is run the way it
is, and the runbook for diagnosing it when `http://localhost:3000` doesn't
come up. Every script under `scripts/pm2-*` and `install-watchdog-task.ps1`
references this file -- keep it in sync with them, and update it (don't just
patch the code) whenever you find a new failure mode, or the next person
will re-diagnose from scratch.

## The symptom this exists to fix

> The app works. Laptop shuts down (or sleeps). Next time
> `http://localhost:3000` is opened: `ERR_CONNECTION_REFUSED`.

This happened repeatedly because `next dev` run from an interactive terminal
dies the moment that terminal, IDE window, or session ends -- there was
nothing to bring it back. The fix is to run it as a background daemon
(PM2) with two independent recovery paths, neither of which depends on a
terminal staying open.

## Architecture

```
Windows logon/resume/timer
        |
        +---> HKCU Run key "PM2" (pm2-windows-startup)
        |         -> wscript invisible.vbs -> pm2_resurrect.cmd -> `pm2 resurrect`
        |         Fires ONLY on a real interactive logon. Does NOT fire on
        |         resume-from-sleep (Windows treats that as continuing the
        |         existing session, not a new logon).
        |
        +---> Scheduled Task "ADASOS-PM2-Watchdog"
                  -> run-watchdog.cmd -> scripts/pm2-watchdog.mjs
                  Fires every 5 min AND at logon (this user's SID). Checks
                  `pm2 jlist`; if adasos-web isn't "online", tries
                  `pm2 resurrect`, then falls back to
                  `pm2 start ecosystem.config.cjs`. This is what actually
                  catches the sleep/resume gap the Run key misses, and it's
                  what self-heals within 5 minutes of ANY kind of crash.

PM2 daemon (God process, PM2_HOME=C:\Users\OMMEKA~1\.pm2)
  -> adasos-web (ecosystem.config.cjs, fork mode, autorestart, min_uptime 10s)
       -> scripts/pm2-dev.mjs
            -> ensurePortFree(3000)      [kills our own stale orphan, or
                                           refuses loudly for a foreign one]
            -> scripts/prepare-backend.mjs   [builds ../dist if missing]
            -> node_modules/next/dist/bin/next dev
```

Logs: `web/.pm2/out.log` + `error.log` (app stdout/stderr, rotated daily by
the `pm2-logrotate` module), `web/.pm2/watchdog.log` (watchdog decisions),
`C:\Users\OMMEKA~1\.pm2\pm2.log` (PM2 daemon's own log -- **this is the one
that shows real exit codes/signals**; the app-level logs often show nothing
because a signal-killed process doesn't get to print anything).

## Root cause, confirmed by direct log inspection (2026-08-07)

`C:\Users\OMMEKA~1\.pm2\pm2.log` showed repeated bursts like:

```
App [adasos-web:1] exited with code [3221225786] via signal [SIGINT]
App [adasos-web:1] starting in -fork mode-
App [adasos-web:1] online
```

`3221225786` is `0xC000013A` = `STATUS_CONTROL_C_EXIT`, the code Windows
gives a console-attached process killed by a console control signal
(Ctrl+C, or the broadcast Windows sends on logoff/shutdown/sleep to
processes sharing a console). It is **not an application crash** -- there is
never a matching stack trace in `error.log` because the process is
terminated before it can write one. PM2's `autorestart` (with
`min_uptime: "10s"`, `max_restarts: 10` in `ecosystem.config.cjs`) absorbs
these automatically; that's why the app is usually back within seconds. 19
occurrences were found in the current `pm2.log` and every single one
self-healed without intervention.

**This part was already working correctly before this investigation.** The
watchdog and startup-registration pieces were already fixing the real
sleep/resume/reboot gap. What was missing was verification, documentation,
and one real gap (below).

## Why previous fixes kept regressing

1. **Nothing was committed to git.** `ecosystem.config.cjs`,
   `scripts/pm2-*.mjs`, `install-watchdog-task.ps1`, and `.gitignore` itself
   were all untracked (`git status` showed `??`) until this pass. Any
   `git clean`, fresh clone, or new machine would silently lose the entire
   reliability layer with no error -- it would just quietly stop existing.
   If you're reading this after cloning fresh: **run
   `npm install && node scripts/prepare-backend.mjs && pm2 start
   ecosystem.config.cjs && pm2 save`, then
   `powershell -File scripts/install-watchdog-task.ps1`, then install
   `pm2-windows-startup` globally and run its `pm2-startup install`.**
2. The scheduled task was originally created by hand (`schtasks /create`
   run interactively, config never saved anywhere) -- so nobody could tell
   what was actually configured or reapply it after it got deleted or
   reset. `install-watchdog-task.ps1` is now the only place that config
   lives; re-run it any time to restore/audit it.
3. Two now-fixed regressions to watch for if the task ever gets recreated
   by hand instead of via the script:
   - `DisallowStartIfOnBatteries` / `StopIfGoingOnBatteries` default to
     `true` in Task Scheduler. On a laptop that's unplugged more than
     plugged in, that silently skips every firing -- no error, no log line,
     while `schtasks /query` still reports the task "Ready"/"Enabled".
     Confirmed live: a 39-hour gap in `watchdog.log` while on battery.
   - An unscoped `<LogonTrigger>` ("at log on of any user") needs an
     elevated shell to register (`schtasks /create` fails with "Access is
     denied" otherwise). Scope it to this user's own SID instead.

## The one real gap found and fixed here: port drift

`next dev` has no "fail if the port is taken" mode. Confirmed by direct
test: occupying `:3000` with an unrelated process, then resurrecting
adasos-web, resulted in Next.js printing `- Local: http://localhost:3001`
and PM2 reporting the app `online` -- because it didn't crash, it just
wasn't on `:3000` anymore. Nothing in the watchdog or PM2 would ever have
flagged this; you'd just get `ERR_CONNECTION_REFUSED` on `:3000` forever
while a perfectly healthy app sat on `:3001`.

Fixed in `scripts/pm2-dev.mjs` (`ensurePortFree`): before spawning `next
dev`, it checks who holds port 3000. If the holder's command line points
into this project's own `web/` tree (a stale orphan from an earlier run
that treekill missed), it kills it and proceeds. If it's genuinely
unrelated, it refuses to start and writes a clear message to `error.log`
with the offending PID and command line, rather than silently drifting to
another port.

## Health check

```
node scripts/health-check.mjs
```

Checks PM2 daemon reachability, whether adasos-web is registered/online,
whether port 3000 is actually listening, the SQLite DB, required `.env`
keys, whether the watchdog task exists and isn't neutered by the battery
defaults above, and an end-to-end HTTP probe.

## Validating a fix to this reliability layer

Don't trust log inspection alone -- prove recovery works:

```bash
# from web/, with PM2_HOME=C:\Users\OMMEKA~1\.pm2
pm2 kill                     # simulates "everything is gone"
# confirm nothing is listening on :3000
pm2 resurrect                # the exact command the logon Run-key fires
# poll http://localhost:3000 until it responds
```

Repeat that cycle several times consecutively. A single pass proves nothing
on Windows given how much of this is timing-sensitive (min_uptime races,
console-signal bursts); five consecutive clean passes is the bar this repo
uses. All five must reach a real HTTP response (`200`/`307`/`302` from the
app, not from something else squatting on the port) within ~30s.

## File map

| Path | Tracked? | Purpose |
|---|---|---|
| `ecosystem.config.cjs` | yes | PM2 app definition |
| `scripts/pm2-dev.mjs` | yes | PM2's actual entrypoint: port guard + prepare-backend + `next dev` |
| `scripts/pm2-watchdog.mjs` | yes | Self-heal check, run by the scheduled task |
| `scripts/health-check.mjs` | yes | One-shot operational health probe |
| `scripts/install-watchdog-task.ps1` | yes | Idempotent installer/auditor for the scheduled task |
| `scripts/run-watchdog.cmd`, `dev-with-path.cmd` | yes | Thin launchers the scheduled task / manual runs call |
| `.pm2/` | **no** (gitignored) | PM2 dump + logs -- regenerated, machine-local |
| `RUN_GUIDE.md` | yes | this file |
