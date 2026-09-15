# Admin / Owner Guide

Audience: system owner / admin. This is the entry point for the Layer 2 (admin) documentation set — start here, then branch out to the specific document you need.

## Start here

- **"I need to change specific behavior X"** → `admin/MASTER_CHANGE_MAP.md` — the single fastest lookup, with exact file paths and required testing/approval steps.
- **"I need to understand the whole system before touching anything"** → `technical/ARCHITECTURE.md`, then `technical/BOSS_AGENT_AND_ROUTING.md`.
- **"I need to know exactly what one agent does and where it lives"** → `agents/INDEX.md`, then the individual agent doc.
- **"I need to configure something specific"** → `admin/SYSTEM_CONFIGURATION.md` (environment/global config), `admin/AGENT_CONFIGURATION.md` (agents), `admin/WORKFLOW_CONFIGURATION.md` (workflows/pipelines), or `admin/INTEGRATION_CONFIGURATION.md` (third-party services).

## Day-to-day operation

- Daily run/start/stop procedure, PM2, and the watchdog: `admin/DEPLOYMENT_OPERATIONS.md`.
- Health check: `cd web && npm run health-check`.
- Environment/configuration reference: `admin/SYSTEM_CONFIGURATION.md`.

## Managing users and access

Two roles exist: `owner` (full access, including approving/rejecting a real remediation) and `viewer` (read-only, denied that one capability). There is no team/multi-user sharing model — see `admin/SUBSCRIPTION_READINESS.md` before assuming you can onboard multiple independent customers on one running instance today.

A user's role is the `role` column on their `User` row (default `"owner"`) — changing it directly in the database is the confirmed mechanism as of this pass. Whether an in-app role-management UI exists is NOT VERIFIED IN CURRENT CODEBASE — check Settings for a role-management option before assuming direct database editing is the only way.

## Reviewing and approving real changes

Real, production-affecting changes (technical remediation fixes, website-development changes) always stop for explicit approval — see `admin/SECURITY_AND_GOVERNANCE.md` for exactly what is shown to you and what the approval binds to (a specific GitHub connection, an expiry window). Only the `owner` role can approve or reject a remediation.

## Monitoring system health and trust

- **Production readiness self-check:** a real, code-executed set of checks (routing, GitHub access, approval-gate lookup, tenant-isolation proof, request flow, live server facts) — see `admin/SECURITY_AND_GOVERNANCE.md` and `technical/LOGGING_AND_AUDIT.md`.
- **Integration health check:** real, direct calls to each connected integration's own already-used functions — never routed through an LLM — see `admin/INTEGRATION_CONFIGURATION.md`'s "Verifying a connection's live state" section.
- **Audit trail:** JSONL files under `var/` (root backend events) plus the `ActivityEvent` table (web-layer events, including every authorization denial) — see `technical/LOGGING_AND_AUDIT.md`.

## Knowing what's real vs. role-play

Before telling a client "the system did X," check the relevant agent's `agents/<id>.md` "Current implementation status" field (field 17). Several agents have a real, working integration (WordPress, Google Business Profile) that is not confirmed connected to that agent's own chat replies — this is documented per-agent under "Known limitations" (field 24), not hidden. See `agents/INDEX.md` for the full execution-mode summary.

## Security posture summary

See `admin/SECURITY_AND_GOVERNANCE.md` for the full picture: authentication, RBAC, client isolation, credential encryption, and any open, unresolved discrepancies (e.g. whether every integration's tokens are actually encrypted at rest, or only documented as such) — confirm before making a security claim to a client.

## Before selling this to a second, independent client/organization

Read `admin/SUBSCRIPTION_READINESS.md` in full first. Today's realistic path is a separate, isolated deployment per customer, not multiple customers on one shared running instance.

## Making a change safely

Follow `admin/MASTER_CHANGE_MAP.md`'s rows for the specific change you're making, and `admin/DOCUMENTATION_MAINTENANCE.md`'s rules for keeping this documentation set in sync with the code as it evolves. For structural changes (adding a new agent or integration), see the step-by-step procedures in `admin/AGENT_CONFIGURATION.md` and `admin/INTEGRATION_CONFIGURATION.md`.

## Full admin document set

| Document | Purpose |
|---|---|
| `admin/MASTER_CHANGE_MAP.md` | Where to change any specific behavior, with exact paths |
| `admin/SYSTEM_CONFIGURATION.md` | Environment variables and global configuration |
| `admin/AGENT_CONFIGURATION.md` | Adding, removing, and configuring agents |
| `admin/WORKFLOW_CONFIGURATION.md` | Configuring the real automated workflows/pipelines |
| `admin/INTEGRATION_CONFIGURATION.md` | Setting up and troubleshooting third-party integrations |
| `admin/SECURITY_AND_GOVERNANCE.md` | Auth, RBAC, encryption, approval gates, isolation |
| `admin/DATA_AND_STORAGE.md` | Database, backups, data model at a glance |
| `admin/DEPLOYMENT_OPERATIONS.md` | Running, restarting, and monitoring the deployed app |
| `admin/TESTING_AND_VALIDATION.md` | Running tests and health checks before trusting a change |
| `admin/TROUBLESHOOTING.md` | Admin-level diagnosis of common problems |
| `admin/MAINTENANCE_GUIDE.md` | Routine operational maintenance tasks |
| `admin/DOCUMENTATION_MAINTENANCE.md` | Keeping this documentation set accurate as code changes |
| `admin/SUBSCRIPTION_READINESS.md` | Honest assessment of multi-tenant/SaaS readiness |
