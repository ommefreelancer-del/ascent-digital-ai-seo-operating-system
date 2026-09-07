# Technical Remediation Workflow

Audience: admin / developer. This is one of only two pipelines in ADASOS that makes a real, production-affecting change (the other is the Web Development change pipeline — see `docs/workflows/` sibling doc references and `docs/security/HUMAN_APPROVAL_SYSTEM.md`).

## Lifecycle

```
DIAGNOSE -> PLAN -> APPROVAL (human, required) -> EXECUTE -> DEPLOY -> VERIFY -> RESOLVED
```

Implemented across `web/src/server/backend/remediation.ts`, `remediation-actions.ts`, and the root `src/boss-agent/remediation/remediation-orchestrator.ts`.

## Approval gate (the critical control point)

- Persisted as a `RemediationApproval` row (Prisma): `status` moves `pending -> approved|rejected|expired -> resolved|failed`.
- **Bound to a specific `connectionId`** (the `GitHubConnection.id` active when the approval was created) — re-validated for a match at decision time. If the connection changed in between, the approval is refused, never silently executed against a different repository/credential.
- **Time-bounded** (`expiresAt`) — an old approval no longer reflecting current site/repo state is refused, not silently honored.
- The exact proposed change (`proposedAction`) is shown to the human verbatim before they decide, and re-used unmodified at execution — never re-derived at execution time.
- RBAC enforcement: only the `"owner"` role may approve or reject (`web/src/server/rbac.ts`'s `assertAuthorized(userId, "approveRemediation"|"rejectRemediation")`); a `"viewer"` attempt is denied and logged as an `ActivityEvent` (category `authorization`).
- The `WebApprovalChannel` (`approval.ts`) never auto-resolves a `deploy_production_change` escalation — it always requires a real human decision via the approve/reject UI, even in this non-interactive HTTP context.

## Scope of real execution (least privilege)

Per in-code comments on `GitHubConnection`, the real execution adapter (`web/src/server/github.ts`'s `GitHubRepositoryAdapter`) is hard-scoped to a narrow, named set of remediation operations (referenced in code as `REMEDIATION_OPERATIONS`, confirmed to include at minimum robots.txt / sitemap.xml / canonical-link fixes) — **NOT VERIFIED IN CURRENT CODEBASE** as an exhaustive list; confirm directly in `github.ts` before assuming broader remediation capability exists.

## Re-audit / before-after loop

`web/src/server/backend/doctor-flow.ts`'s `runFullReAudit()` runs a second real audit against the same URL after a genuine execution attempt, producing a real before/after comparison. It only ever runs after an approved-and-actually-run execution (`resolved`/`failed`/`failed_with_rollback`/`rollback_failed`) — never after a merely-pending or rejected approval.

## Persistence

`RemediationApproval` and `RemediationExecutionRecord` (Prisma) — the latter records `startedAt`, `completedAt`, `result` (`success`|`failed`|`blocked`), `changedFilesJson`, `commitReference`, `deploymentReference`, `verificationReference`, `rollbackReference`, `error`, `finalStatus`. One row per execution attempt that actually reached execution — never created for a task that stopped at BLOCKED/REJECTED before execution.

## Where to modify

- Approval/execution logic: `web/src/server/backend/remediation.ts`, `remediation-actions.ts`.
- Root orchestrator: `src/boss-agent/remediation/remediation-orchestrator.ts`.
- Approval UI/API: workspace remediation approve/reject routes (confirm exact route path directly — not fully enumerated in this pass).
- RBAC gate: `web/src/server/rbac.ts`.
- Re-audit loop: `web/src/server/backend/doctor-flow.ts`.
- Database models: `RemediationApproval`, `RemediationExecutionRecord` in `web/prisma/schema.prisma`.
- Never-auto-resolve escalation reasons: `web/src/server/backend/approval.ts`'s `NEVER_AUTO_RESOLVE_REASONS` (security-sensitive — see `docs/architecture/BOSS_AGENT_AND_ROUTING.md`).
