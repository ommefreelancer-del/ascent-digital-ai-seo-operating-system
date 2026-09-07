# Deployment Operations

Audience: admin / owner. Source: `RUN_GUIDE.md` (full text, verified), `web/src/server/db.ts`, `.github/workflows/ci.yml`. This document distinguishes VERIFIED (actually running, described in the repository's own operational docs) from NOT VERIFIED / NOT IMPLEMENTED (referenced as a future step, not present today). See `technical/DEPLOYMENT_REFERENCE.md` for the developer-facing technical detail.

## VERIFIED: current real deployment

**ADASOS runs as a local development server on one Windows machine, run as `next dev` under PM2 — this is explicitly documented in the repository's own `RUN_GUIDE.md` as "a local development setup... not a production deployment," suitable for daily personal use.**

Concretely:
- **Process manager:** PM2 (`web/ecosystem.config.cjs`), process name `adasos-web`, fork mode, single instance (no cluster setting) — one process on one machine, no load balancer, no second server.
- **Auto-restart on crash:** `autorestart: true`, `max_restarts: 10`, `min_uptime: "10s"` — the restart counter resets after 10s of stability, so this does not cap lifetime restarts, only crash-loops.
- **Auto-start on boot:** `pm2-windows-startup`, registered under `HKCU\...\Run`, runs `pm2 resurrect` at logon. Documented as unverifiable in practice (no stdout/stderr capture) — treated as a bonus, not the real safety mechanism.
- **The real safety mechanism: `ADASOS-PM2-Watchdog`** — a Windows Scheduled Task (`web/scripts/run-watchdog.cmd` → `pm2-watchdog.mjs`) polling every 5 minutes (plus at logon) and calling `pm2 resurrect` (falling back to `pm2 start ecosystem.config.cjs`) whenever `adasos-web` isn't online. Source of truth for its configuration is `web/scripts/install-watchdog-task.ps1` — re-run this after any deletion, misconfiguration, or machine migration; never recreate the task by hand.
- **Known, previously-live defects, now fixed (useful admin history):** (1) a laptop resuming from sleep does not re-trigger the logon Run-key — only the watchdog catches this; (2) the Scheduled Task's default `DisallowStartIfOnBatteries=true` silently skipped every firing while unplugged, with no error and a "Ready"/"Enabled" status still shown — fixed by the install script; (3) `next dev` silently drifts to port 3001 if 3000 is occupied with no crash — fixed by `pm2-dev.mjs`'s `ensurePortFree()`, which kills a stale orphan from this project or refuses to start and logs the conflicting PID.
- **Log rotation:** `pm2-logrotate` module, 10MB max file size, 14-day retention, gzip, daily rotation at midnight.
- **Health check:** `npm run health-check` (from `web/`) checks PM2 daemon reachability, process status, port 3000, SQLite integrity, required `.env` keys, and a live HTTP request — prints PASS/FAIL per check and exits non-zero on any failure. Also checks specifically for the battery-blocking Scheduled Task regression.

## VERIFIED: database in production (as currently deployed)

SQLite, deliberately kept rather than swapped for Postgres/MySQL, because this matches the actual single-process, single-machine deployment. See `admin/DATA_AND_STORAGE.md` for schema/migration/backup detail.

## NOT IMPLEMENTED / requires a user-provisioned resource

- **Horizontal scaling** (multiple processes/servers, a load balancer, PM2 cluster mode): not supported by SQLite and explicitly not attempted.
- **A hosted/cloud production deployment** (a real domain, HTTPS, a managed hosting platform): NOT VERIFIED IN CURRENT CODEBASE as existing. Everything described above is a local Windows machine's own PM2 setup with a watchdog for reliability — a legitimate small-scale production pattern for a single-operator tool, but not a multi-user, internet-facing SaaS deployment.
- **Automated off-box backups.**

## Fresh-clone / new-machine bring-up (verified procedure from RUN_GUIDE.md)

```bash
npm install
node web/scripts/prepare-backend.mjs
cd web
pm2 start ecosystem.config.cjs
pm2 save
powershell -File scripts/install-watchdog-task.ps1
# then install pm2-windows-startup globally and run its `pm2-startup install`
```

Also required once per fresh clone: `git config core.hooksPath .githooks` — a `pre-commit` hook refuses any commit while untracked-and-not-gitignored files exist, specifically to prevent a repeat of a real, documented past incident where the entire PM2/watchdog reliability layer (and, separately, nearly all of `web/`'s own source) was untracked for weeks and would have silently vanished on a fresh clone or `git clean`.

## CI (build/test gate, not a deployment mechanism)

`.github/workflows/ci.yml` runs on every push/PR to `main`: a `backend` job (`typecheck` → `build` → `test`), then a `web` job (rebuild root → web `typecheck` → web `test` → a startup-validation step that writes a CI-only `.env`, runs `prisma db push`, and runs `scripts/validate-startup.mjs`). This gates code merges; it does not itself deploy anything to the running Windows machine. See `admin/TESTING_AND_VALIDATION.md`.

## Environment configuration

See `admin/SYSTEM_CONFIGURATION.md` for the full variable list.

## Where to modify

- Process definition: `web/ecosystem.config.cjs`.
- Watchdog: `web/scripts/pm2-watchdog.mjs`, `install-watchdog-task.ps1`.
- Health check: `web/scripts/health-check.mjs`.
- Migration commands: `web/package.json`'s `db:migrate:*` scripts.
- CI: `.github/workflows/ci.yml`.
