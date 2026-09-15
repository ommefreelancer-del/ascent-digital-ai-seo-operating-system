# Authentication & RBAC

Audience: developer/engineer.

## Authentication

NextAuth, JWT session strategy (`maxAge`: 30 days), `CredentialsProvider` only (email + bcrypt password hash) — confirmed the sole registered provider in `web/src/server/auth.ts`. `GOOGLE_CLIENT_ID`/`SECRET` are unrelated to login (see `DOCUMENTATION_CONFLICTS.md` Resolved 1).

**Production secret hardening:** at module load, if `NODE_ENV=production`, the app throws if `NEXTAUTH_SECRET` is unset, matches a known placeholder, or is under 32 characters. Defense-in-depth alongside `scripts/validate-startup.mjs`'s build-time check, covering the case where a built image is started via `next start` without going through `npm`'s script chain.

**Login rate limiting:** in-memory, single-instance (`web/src/server/rate-limit.ts`) — 10 attempts per 15 minutes per `ip:email` key, enforced in `auth.ts`'s `authorize()`. A multi-instance deployment needs a shared store (e.g. Redis) instead — a documented, real scaling limitation of the current architecture, not a defect at current scale.

## RBAC

`web/src/server/rbac.ts` defines exactly two roles:

| Role | Capabilities |
|---|---|
| `owner` (schema default) | `approveRemediation`, `rejectRemediation` |
| `viewer` | none |

- No separate Role/Permission table exists — `User.role` is the sole enforced field.
- `assertAuthorized(userId, capability)` gates exactly one real decision point in the entire system, confirmed by direct import in `web/src/server/backend/remediation.ts`: approving/rejecting a `RemediationApproval`. Every other feature is unaffected by role.
- **Fail closed:** an unknown/malformed role value normalizes to `"viewer"` — never `"owner"` (the schema column is a plain `String`, not a DB-level enum).
- Every denial is logged as a real `ActivityEvent` (`category: "authorization"`) — never silent.
- **This is explicitly NOT a multi-tenant sharing model.** `rbac.ts`'s own header states there is no Organization/Team/Workspace-with-multiple-members concept, confirmed by a direct grep for invite/team-member/organization/workspace-member/seat terminology. `role` is a capability level for what one account may do to its own data, never cross-account permission sharing. See `admin/SUBSCRIPTION_READINESS.md`.

## The one real approval-gated capability, end to end

`web/src/server/backend/remediation.ts` imports `assertAuthorized` from `rbac.ts` and calls it before allowing a decision on a `RemediationApproval`. This is the single, concrete place RBAC affects real behavior in the running product today. See `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`.

## Escalation-channel enforcement (a second layer of "no auto-approval")

Independent of RBAC, `web/src/server/backend/approval.ts`'s `WebApprovalChannel` never auto-resolves `deploy_production_change` (or several other uncertain/high-stakes escalation reasons) — always resolving to `rejected`, regardless of role, when a non-interactive web request cannot supply genuine human authorization. See `BOSS_AGENT_AND_ROUTING.md`.

## Where to modify

- Roles/capabilities: `web/src/server/rbac.ts`.
- Rate limiting: `web/src/server/rate-limit.ts`.
- Production secret checks: `web/src/server/auth.ts` (top-of-file guard).
- Approval-channel enforcement: `web/src/server/backend/approval.ts`.
