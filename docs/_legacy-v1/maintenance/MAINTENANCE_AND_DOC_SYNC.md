# Maintenance & Documentation Sync Guide

Audience: admin / owner.

## Routine maintenance (from RUN_GUIDE.md, verified)

- **Log rotation** is automatic (`pm2-logrotate`, 10MB/14-day/gzip) — no manual action needed under normal operation.
- **Watchdog health:** periodically run `npm run health-check` (from `web/`) and glance at `web/.pm2/watchdog.log` — especially after any Windows update, machine migration, or change to power settings, since a past real incident silently disabled the watchdog via a Windows Scheduled Task default (`DisallowStartIfOnBatteries`) with no visible error.
- **After any change to `ecosystem.config.cjs` or the running process list:** run `pm2 save` so the saved snapshot used by `pm2 resurrect` reflects the current state.
- **Database backups:** not automated (see `docs/deployment/DEPLOYMENT_GUIDE.md`). Until automated, periodically checkpoint WAL (`PRAGMA wal_checkpoint(TRUNCATE);`) and copy `web/prisma/prisma/dev.db` to off-machine storage.
- **Dependency updates:** no automated dependency-update process was found in this pass; treat `npm ci`/CI passing as the acceptance bar for any manual dependency bump.

## Documentation maintenance principle

This documentation set (`docs/`) is a snapshot, verified against the codebase as of the date of this pass. It will drift from the real code over time unless treated as a first-class maintenance responsibility. Practical rules:

1. **Any change that alters a `MASTER_CHANGE_MAP.md` row's answer must update that row in the same change/PR.** Treat a stale Master Change Map as a real defect, not a cosmetic one — it is the single most load-bearing document for a future maintainer.
2. **Any change to an agent's execution mode** (role-play → real, or vice versa) must update that agent's `docs/agents/<id>.md` "Execution mode" and "Where to modify" sections in the same change.
3. **Any new agent, integration, or Prisma model** must be added to the relevant reference doc (`docs/agents/INDEX.md`, `docs/integrations/INTEGRATIONS_REFERENCE.md`, `docs/database/DATA_MODEL.md`) per `docs/change-management/CHANGE_MANAGEMENT_GUIDE.md`.
4. **Never delete or silently overwrite an existing hand-authored doc** (e.g. the pre-existing `docs/architecture/*.md`, `docs/governance/*.md`, `docs/bing-webmaster-integration.md`) to resolve an apparent conflict with newer documentation — record the conflict in `docs/architecture/DOCUMENTATION_CONFLICTS.md` instead and let a human reconcile it.
5. **Anything marked `NOT VERIFIED IN CURRENT CODEBASE`** in this doc set is an open item, not a permanent state — when someone does verify it, update the relevant file to remove the flag and record what was confirmed.
6. **A documentation-only PR is legitimate** — do not require every doc update to be bundled with a functional code change; drift correction on its own is valuable and should not be blocked.
7. **Recommended cadence:** a full re-audit (re-verifying agent execution modes, integration statuses, and the change map) at least once per major version bump of `web/package.json`, or after any change touching `messages/route.ts`'s dispatch branches, `schema.prisma`, or `rbac.ts`.

## How to re-verify a specific claim quickly

- **Is agent X real or role-play in chat?** grep `messages/route.ts` for `<X>_AGENT_ID` and check whether it appears in an `assignedAgentId === ...` branch with real logic, or falls through to `generateSpecialistReply()`.
- **Is integration Y wired into chat?** grep the relevant `web/src/server/backend/*.ts` module for a call to the integration's client module (`web/src/server/<y>.ts`), and confirm that module is actually invoked from a chat-dispatch branch, not just from a Settings/Integrations UI route.
- **Is a Prisma field really encrypted?** grep for the literal call site `encryptSecret(` and confirm the field in question is the argument, rather than trusting an in-line schema comment alone (see Documentation Conflict 8).
