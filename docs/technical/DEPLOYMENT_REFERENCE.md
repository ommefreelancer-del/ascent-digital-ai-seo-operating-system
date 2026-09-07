# Deployment Reference

Audience: developer/engineer. Operational runbook version: `admin/DEPLOYMENT_OPERATIONS.md`. Source: `RUN_GUIDE.md` (fully read), `web/src/server/db.ts`, `.github/workflows/ci.yml`.

## Current real deployment

**Local development server (`next dev`) under PM2, on one Windows machine — explicitly documented in `RUN_GUIDE.md` as "a local development setup... not a production deployment."**

- Process manager: PM2, process `adasos-web`, fork mode, single instance (`web/ecosystem.config.cjs`, no `instances`/cluster setting).
- Auto-restart: `autorestart: true`, `max_restarts: 10`, `min_uptime: "10s"`.
- Auto-start on boot: `pm2-windows-startup` under `HKCU\...\Run` (documented as unverifiable in practice — no stdout/stderr capture).
- Real safety net: `ADASOS-PM2-Watchdog` Scheduled Task (`web/scripts/run-watchdog.cmd` → `pm2-watchdog.mjs`), polling every 5 minutes plus at logon, calling `pm2 resurrect` (falling back to `pm2 start ecosystem.config.cjs`). Source of truth for its config: `web/scripts/install-watchdog-task.ps1`.
- Documented, fixed historical defects: sleep-resume doesn't retrigger the logon Run-key (watchdog catches it); Scheduled Task's `DisallowStartIfOnBatteries` default silently skipped every firing on battery with no error (fixed by the install script); `next dev` silently drifting to port 3001 on a port conflict (fixed by `pm2-dev.mjs`'s `ensurePortFree()`).
- Log rotation: `pm2-logrotate`, 10MB/14-day/gzip/daily.
- Health check: `npm run health-check` (`web/scripts/health-check.mjs`) — PM2 daemon reachability, process status, port 3000, SQLite integrity, required `.env` keys, live HTTP request.

## Database in production (as deployed)

SQLite, deliberately kept (matches the single-process/single-machine architecture). `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000` (`web/src/server/db.ts`, applied once per database file, idempotently reapplied on every process start). Migrations via `npm run db:migrate:deploy` — a deliberate manual step after pulling new code, before restarting `adasos-web`, never auto-applied during build.

**Backup:** single file of record `web/prisma/prisma/dev.db` (note the doubled `prisma/prisma` path — Prisma resolves a relative `DATABASE_URL` against `schema.prisma`'s own directory, not the project root). WAL mode means recent writes can briefly live in a `-wal` file — checkpoint (`PRAGMA wal_checkpoint(TRUNCATE);`) before copying. **No automated backup schedule exists.**

## Not implemented

- Horizontal scaling (multiple processes/servers, load balancer, PM2 cluster mode) — not supported by SQLite, not attempted. Documented path if needed: provision a real Postgres instance, change `schema.prisma`'s `datasource db.provider` to `postgresql` plus a new `DATABASE_URL`.
- A hosted/cloud production deployment (real domain, HTTPS, managed platform) — NOT VERIFIED as existing; everything above is a local machine's PM2 setup.
- Automated off-box backups.

## Fresh-clone bring-up (verified procedure)

```bash
npm install
node web/scripts/prepare-backend.mjs
cd web
pm2 start ecosystem.config.cjs
pm2 save
powershell -File scripts/install-watchdog-task.ps1
# then install pm2-windows-startup globally and run its `pm2-startup install`
```

Also required once per clone: `git config core.hooksPath .githooks` — a `pre-commit` hook refuses any commit while untracked-and-not-gitignored files exist, specifically to prevent a repeat of a real, documented past incident where the PM2/watchdog reliability layer (and, separately, nearly all of `web/`'s own source) was untracked for weeks.

## CI (build/test gate, not a deployment mechanism)

See `TESTING_REFERENCE.md`. CI does not deploy anything to the running machine.

## Where to modify

- Process definition: `web/ecosystem.config.cjs`.
- Watchdog: `web/scripts/pm2-watchdog.mjs`, `install-watchdog-task.ps1`.
- Health check: `web/scripts/health-check.mjs`.
- Migration commands: `web/package.json`'s `db:migrate:*` scripts.
- CI: `.github/workflows/ci.yml`.
