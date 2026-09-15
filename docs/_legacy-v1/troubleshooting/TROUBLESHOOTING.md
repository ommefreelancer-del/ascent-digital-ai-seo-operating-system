# Troubleshooting

Audience: both client/end-user and admin — sections are marked accordingly.

## For any user: "The AI gave an answer that seems made up"

ADASOS is designed to avoid fabricating data, but not every one of the 27 specialists has real, tool-executed access to every topic they can discuss (see `docs/agents/INDEX.md`'s execution-mode column). If a reply describes an action (e.g. "I've updated your WordPress site" or "I've sent that outreach email") that you did not separately approve or confirm, treat it as a description of what *would* happen, not a confirmed action, and verify directly in the relevant system (WordPress, Gmail, GitHub) — several agents' real integrations exist but are not yet confirmed connected to their own chat replies (see each agent's "Known limitations"). If in doubt, ask the admin to check `docs/agents/<agent>.md` for that agent's exact execution mode.

## For any user: "I approved something but nothing happened"

Only two capabilities in ADASOS make a real, production-affecting change after approval: Technical Remediation (a real fix to a connected repository) and Web Development Agent's website-change pipeline (a real commit to a connected repository). Both require a connected GitHub repository first (Settings → Integrations). If nothing happened after approving, the most common causes are: no GitHub repository connected yet, the GitHub connection's status is not `active` (e.g. still `pending_repository_selection` or `revoked`), or the approval expired before being acted on (approvals have a real expiry window). Ask an admin to check `RemediationApproval`/`WebDevelopmentChange` status directly if this persists.

## Admin: app not reachable (local Windows deployment)

1. `cd web && npm run health-check` — checks PM2 daemon reachability, process status, port 3000, SQLite integrity, required `.env` keys, and a live HTTP request; reports PASS/FAIL per check.
2. Check `web/.pm2/watchdog.log` — the `ADASOS-PM2-Watchdog` Scheduled Task should self-heal within 5 minutes of any crash or reboot.
3. Manual recovery: `pm2 resurrect` (falls back to `pm2 start ecosystem.config.cjs` from `web/`).
4. **After waking from sleep** specifically: this is the one case the Windows logon Run-key does NOT cover (it only fires on a real logon, not a sleep-resume) — rely on the watchdog or run step 3 manually.
5. **If the watchdog itself seems to have stopped working**, check for the Windows Task Scheduler "battery" defaults regression: `schtasks /query /tn "ADASOS-PM2-Watchdog" /v /fo list` and look for `DisallowStartIfOnBatteries`/`StopIfGoingOnBatteries` — if either is `true`, re-run `powershell -File web/scripts/install-watchdog-task.ps1` to fix it. `npm run health-check` also checks for this specific regression.

## Admin: "Port 3000 already in use" / app seems up but unreachable

`next dev` can silently drift to port 3001 if 3000 is occupied — check the actual bound port. `pm2-dev.mjs`'s `ensurePortFree()` should prevent this by killing a stale orphan from this project or refusing to start with a clear error naming the conflicting PID — check `web/error.log` if this happens.

## Admin: "Backend changes don't show up in the web app"

Root-layer (`src/`) changes are compiled to `dist/`, which the web app dynamically imports — delete the `dist/` folder at the repo root and restart; `predev` rebuilds it automatically. If you changed `web/src/` instead, this step is not needed.

## Admin: auth/session errors after a change

Delete `web/.next` (build cache) and restart.

## Admin: app refuses to start in production with a NEXTAUTH_SECRET error

This is intentional, hardened behavior (`auth.ts`), not a bug: `NODE_ENV=production` requires a real `NEXTAUTH_SECRET` at least 32 characters and not equal to a known placeholder. Generate one with `openssl rand -base64 32` and set it in the real production environment (never commit it).

## Admin: an integration shows "not configured"

This is the intended, honest behavior for every optional integration when its environment variable(s) are unset — see `docs/configuration/ENVIRONMENT_VARIABLES.md` for exactly which variable(s) that integration needs and where to obtain them.

## Admin: a remediation or web-development approval was rejected automatically

Check the escalation reason. Several reasons (`capability_unavailable`, `deploy_production_change`, `low_confidence_match`, `ambiguous_match`, `requested_agent_not_found`) are designed to **never** auto-resolve to a candidate — they always resolve to `rejected` with an honest note, by design (see `docs/security/HUMAN_APPROVAL_SYSTEM.md`). This is not a bug; it means Boss Agent could not confidently or safely proceed and is asking for a clearer request or a real human decision.

## Where to escalate an unresolved issue

If a troubleshooting step here doesn't resolve the issue, check `docs/architecture/DOCUMENTATION_CONFLICTS.md` and the relevant agent/integration doc's "Known limitations" — the issue may be a documented, real gap rather than a new defect. If it appears to be a genuinely new defect, record it rather than silently working around it (see the "Documentation Findings / Engineering Follow-ups" convention used throughout this doc set).
