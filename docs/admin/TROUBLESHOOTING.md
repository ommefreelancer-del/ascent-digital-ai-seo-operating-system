# Troubleshooting (Admin)

Audience: admin. For the client-facing version of this document (no internal paths, no technical detail), see `client/TROUBLESHOOTING.md`.

## App not reachable (local Windows deployment)

1. `cd web && npm run health-check` — checks PM2 daemon reachability, process status, port 3000, SQLite integrity, required `.env` keys, and a live HTTP request; reports PASS/FAIL per check.
2. Check `web/.pm2/watchdog.log` — the `ADASOS-PM2-Watchdog` Scheduled Task should self-heal within 5 minutes of any crash or reboot.
3. Manual recovery: `pm2 resurrect` (falls back to `pm2 start ecosystem.config.cjs` from `web/`).
4. **After waking from sleep** specifically: this is the one case the Windows logon Run-key does not cover (it only fires on a real logon, not a sleep-resume) — rely on the watchdog or run step 3 manually.
5. **If the watchdog itself seems to have stopped working**, check for the Windows Task Scheduler "battery" defaults regression: `schtasks /query /tn "ADASOS-PM2-Watchdog" /v /fo list` and look for `DisallowStartIfOnBatteries`/`StopIfGoingOnBatteries` — if either is `true`, re-run `powershell -File web/scripts/install-watchdog-task.ps1` to fix it. `npm run health-check` also checks for this specific regression.

## "Port 3000 already in use" / app seems up but unreachable

`next dev` can silently drift to port 3001 if 3000 is occupied — check the actual bound port. `pm2-dev.mjs`'s `ensurePortFree()` should prevent this by killing a stale orphan from this project or refusing to start with a clear error naming the conflicting PID — check `web/error.log` if this happens.

## "Backend changes don't show up in the web app"

Root-layer (`src/`) changes are compiled to `dist/`, which the web app dynamically imports — delete the `dist/` folder at the repo root and restart; `predev` rebuilds it automatically. If you changed `web/src/` instead, this step is not needed.

## Auth/session errors after a change

Delete `web/.next` (build cache) and restart.

## App refuses to start in production with a `NEXTAUTH_SECRET` error

This is intentional, hardened behavior (`auth.ts`), not a bug: `NODE_ENV=production` requires a real `NEXTAUTH_SECRET` at least 32 characters and not equal to a known placeholder. Generate one with `openssl rand -base64 32` and set it in the real production environment (never commit it).

## An integration shows "not configured"

This is the intended, honest behavior for every optional integration when its environment variable(s) are unset — see `admin/SYSTEM_CONFIGURATION.md` for exactly which variable(s) that integration needs.

## A remediation or web-development approval was rejected automatically

Check the escalation reason. Several reasons (`capability_unavailable`, `deploy_production_change`, `low_confidence_match`, `ambiguous_match`, `requested_agent_not_found`) are designed to never auto-resolve to a candidate — they always resolve to `rejected` with an honest note, by design (see `admin/SECURITY_AND_GOVERNANCE.md`). This is not a bug; it means Boss Agent could not confidently or safely proceed and is asking for a clearer request or a real human decision.

## A client reports an agent "did something" that doesn't match reality

Check that agent's `agents/<id>.md` field 17 ("Current implementation status") and field 24 ("Known limitations"). Several agents have a real, working integration that is not confirmed connected to that specific agent's own chat replies — this is a documented gap, not necessarily a new defect. See `agents/INDEX.md` for the full execution-mode picture.

## Where to escalate an unresolved issue

If a troubleshooting step here doesn't resolve the issue, check `technical/DOCUMENTATION_CONFLICTS.md` and the relevant agent/integration doc's "Known limitations" — the issue may be a documented, real gap rather than a new defect. If it appears to be a genuinely new defect, record it as a documentation finding/engineering follow-up rather than silently working around it — see `admin/DOCUMENTATION_MAINTENANCE.md`.
