# Security & Governance (Admin)

Audience: admin / owner. This is the operational summary; for full technical depth see `technical/SECURITY_ARCHITECTURE.md`, `technical/AUTH_AND_RBAC.md`, and `technical/LOGGING_AND_AUDIT.md`. Evidence sources: `web/src/server/rbac.ts`, `rate-limit.ts`, `credential-encryption.ts`, `auth.ts`, `admin-governance.ts` (all fully read during this pass).

## Authentication

- NextAuth, JWT session strategy (30-day max age), `CredentialsProvider` only (email + bcrypt password hash) — confirmed as the sole registered provider in `auth.ts`. `GOOGLE_CLIENT_ID`/`SECRET` are used only for Google service *connections*, never for login — see `technical/DOCUMENTATION_CONFLICTS.md` (Resolved 1).
- **Production secret hardening:** at module load, if `NODE_ENV=production`, the app refuses to start if `NEXTAUTH_SECRET` is unset, matches a known placeholder value, or is shorter than 32 characters. This is defense-in-depth alongside `scripts/validate-startup.mjs`'s build-time check, covering the case where a built image is started directly via `next start`.
- **Login rate limiting:** in-memory, single-instance (`rate-limit.ts`) — 10 attempts per 15 minutes per `ip:email` key, enforced in `auth.ts`'s `authorize()`. A multi-instance deployment would need a shared store (e.g. Redis) instead — a real, documented scaling limitation, not a defect at current scale.

## Authorization (RBAC)

- Exactly two roles: `"owner"` (schema default — full access) and `"viewer"` (read-only). No separate Role/Permission table exists — `User.role` is the sole enforced field.
- `assertAuthorized(userId, capability)` gates exactly one real decision point in the entire system: approving or rejecting a `RemediationApproval`. Every other feature in the product is unaffected by role.
- **Fail closed:** an unknown or malformed role value normalizes to `"viewer"` — the least-privileged role — never to `"owner"`.
- Every denial is logged as a real `ActivityEvent` (`category: "authorization"`) — denials are never silent.
- **This is explicitly not a multi-tenant sharing model.** There is no Organization/Team/Workspace-with-multiple-members concept anywhere in this codebase. `role` is a capability level for what one account may do to its own data (e.g. a read-only stakeholder login using the same account), never a cross-account permission-sharing system. See `admin/SUBSCRIPTION_READINESS.md`.

## Client-data isolation

Enforced unconditionally, separately from role, via `userId`/`ownerId`/`workspaceId` foreign keys on every sensitive model (see `admin/DATA_AND_STORAGE.md`). Every real lookup in the codebase filters by the requesting session's own id. A real, executed self-check exists (`system-readiness.ts`) that proves a synthetic, definitely-nonexistent workspace id returns zero rows through the same real, workspace-scoped lookup function real workspaces use.

## Credential encryption at rest

- `web/src/server/credential-encryption.ts`: AES-256-GCM, via `CREDENTIAL_ENCRYPTION_KEY` (32-byte key, hex or base64). Never logs plaintext or ciphertext in an error message. Decryption verifies the GCM auth tag — a tampered or wrong-key value throws rather than returning corrupted data.
- **Confirmed encrypted as of this pass:** `GitHubConnection`'s access token, Google Search Console's tokens, WordPress's app password/access token fields (both providers), and the shared Google service connection tokens (Business Profile, Sheets, Analytics, Drive, Gmail).
- **Historical note, preserved for context:** `credential-encryption.ts`'s own header comment states this mechanism was introduced specifically for `GitHubConnection`, and that it does not retroactively fix any pre-existing plaintext storage on other connection types. As of this pass, direct import/call-site verification confirms WordPress and Google Search Console do use real encryption — the header comment is now stale (recorded as an Engineering Follow-up in `technical/DOCUMENTATION_CONFLICTS.md`, not fixed, per the documentation-only scope of this pass).

## Production-affecting changes require human approval

Real, production-affecting changes — a technical remediation fix, a Web Development Agent code change — always stop for explicit owner approval before anything is written to a connected repository. See `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md` and `agents/web-development-agent.md` for exactly what is shown to the approver and what the approval binds to (a specific GitHub connection, a real expiry window). Certain escalation reasons (`capability_unavailable`, `deploy_production_change`, `low_confidence_match`, `ambiguous_match`, `requested_agent_not_found`) are deliberately designed to never auto-resolve — they always resolve to `rejected`, by design, not as a bug.

## Governance evidence for Admin Agent

`admin-governance.ts` assembles real, live, self-scoped (never cross-tenant) governance evidence — user access, RBAC state, client-isolation description, approval-control counts, and real audit-log-file inspection — and feeds it to Admin Agent's prompt so governance/security questions are answered from real numbers, never fabricated. Where the schema genuinely has no granular RBAC model, the evidence states that honestly rather than describing a permission system that doesn't exist.

## Audit trail

- **Root backend events:** JSONL files under `var/` (e.g. `var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`).
- **Web-layer events:** the `ActivityEvent` table, including every authorization denial.

See `technical/LOGGING_AND_AUDIT.md` for the full logging architecture.

## Before making a security claim to a client

Confirm the specific claim directly in code rather than repeating documentation from memory — this document is accurate as of the date of this pass, but security-relevant code changes fastest and drifts from documentation quickest. See `admin/DOCUMENTATION_MAINTENANCE.md`'s re-verification cadence.

## Where to modify

- Roles/capabilities: `web/src/server/rbac.ts`.
- Rate limiting: `web/src/server/rate-limit.ts`.
- Encryption: `web/src/server/credential-encryption.ts`.
- Production secret checks: `web/src/server/auth.ts` (top-of-file guard).
- Governance evidence assembly: `web/src/server/backend/admin-governance.ts`.
- Approval gating: `web/src/server/backend/approval.ts`, `remediation.ts`, `web-development.ts`.
