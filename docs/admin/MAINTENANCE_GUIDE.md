# Maintenance Guide

Audience: admin / owner. Covers routine operational maintenance. For keeping the documentation itself in sync with the code, see `admin/DOCUMENTATION_MAINTENANCE.md`.

## Routine maintenance (from RUN_GUIDE.md, verified)

- **Log rotation** is automatic (`pm2-logrotate`, 10MB/14-day/gzip) — no manual action needed under normal operation.
- **Watchdog health:** periodically run `npm run health-check` (from `web/`) and glance at `web/.pm2/watchdog.log` — especially after any Windows update, machine migration, or change to power settings, since a past real incident silently disabled the watchdog via a Windows Scheduled Task default (`DisallowStartIfOnBatteries`) with no visible error.
- **After any change to `ecosystem.config.cjs` or the running process list:** run `pm2 save` so the saved snapshot used by `pm2 resurrect` reflects the current state.
- **Database backups:** not automated (see `admin/DATA_AND_STORAGE.md`). Until automated, periodically checkpoint WAL (`PRAGMA wal_checkpoint(TRUNCATE);`) and copy `web/prisma/prisma/dev.db` to off-machine storage.
- **Dependency updates:** no automated dependency-update process was found in this pass; treat `npm ci`/CI passing as the acceptance bar for any manual dependency bump.
- **Integration health:** periodically check Settings → Integrations (or the underlying `integration-health-check.ts` calls) for any connection that has silently moved to `revoked`/`invalid` — OAuth tokens can expire or be revoked externally without the system proactively notifying an admin.
- **Approval backlog:** periodically review any pending `RemediationApproval`/`WebDevelopmentChange` rows that are approaching their expiry window, since an expired approval requires the underlying proposal to be regenerated from the current state of the site.

## Recommended maintenance cadence

| Task | Frequency |
|---|---|
| `npm run health-check` | Weekly, or after any machine/power-setting change |
| Database backup (manual, until automated) | Weekly at minimum |
| Integration connection status review | Monthly |
| Full documentation re-audit (see `admin/DOCUMENTATION_MAINTENANCE.md`) | At least once per major version bump of `web/package.json`, or after any change touching `messages/route.ts`'s dispatch branches, `schema.prisma`, or `rbac.ts` |
| Dependency review (`npm outdated`) | Quarterly |

## When something seems wrong

Start with `admin/TROUBLESHOOTING.md`. If the issue isn't listed there, check `technical/DOCUMENTATION_CONFLICTS.md` and the relevant agent/integration doc's "Known limitations" before assuming it's a new defect — several apparent problems are documented, real gaps rather than regressions.

## Where to modify

- Process/watchdog config: `web/ecosystem.config.cjs`, `web/scripts/pm2-watchdog.mjs`, `install-watchdog-task.ps1`.
- Health check: `web/scripts/health-check.mjs`.
- Backup procedure: manual today — see `admin/DATA_AND_STORAGE.md` for the exact file and WAL-checkpoint command.
