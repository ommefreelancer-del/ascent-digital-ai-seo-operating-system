# Human Approval System

Audience: admin / owner. Cross-reference: `docs/workflows/AUDIT_REMEDIATION_WORKFLOW.md`, `docs/agents/web-development-agent.md`.

## The core principle (GLOBAL_RULES.md §9 / §13)

`GLOBAL_RULES.md` requires genuine human authorization before any high-impact or production-affecting decision. Two real pipelines in the live product implement this as actual, enforced database-backed state — not merely as a written policy:

1. **Technical remediation** (`RemediationApproval`)
2. **Web Development Agent's website changes** (`WebDevelopmentChange`)

## Common shape both approval models share

- Persisted (never purely in-memory or conversational) — an approval decision has a real database row.
- Bound to a specific connection (`connectionId`), re-validated for a match at decision time — a connection swapped in between is refused, never silently honored against a different repository/credential.
- The exact real proposed change (`proposedAction` / `filesJson`) is captured and shown verbatim before a decision, then re-used unmodified at execution — never re-derived.
- Status lifecycle moves forward only (`pending_approval` → `approved`/`rejected` → `committed`/`resolved`/`failed`) — rows are never deleted, preserving the audit trail.

## `RemediationApproval`-specific

- Additionally has an `expiresAt` — an old approval no longer reflecting current site/repo state is refused, not silently honored.
- Gated by RBAC: only `"owner"` role may approve/reject (`rbac.ts`'s `assertAuthorized`); `"viewer"` is denied and the denial is logged.

## Why this can't just be a stateless HTTP approval

`web/src/server/backend/approval.ts`'s own header explains: the frozen root backend's governance model expects a real human-in-the-loop `ApprovalChannel`; the CLI implementation blocks on a terminal prompt, which has no equivalent in a stateless web request. `WebApprovalChannel` is the web-layer's non-interactive stand-in — but it is explicitly engineered to **never** auto-resolve the escalation reasons that represent a genuinely high-stakes or genuinely uncertain decision (`deploy_production_change`, `capability_unavailable`, `low_confidence_match`, `ambiguous_match`, `requested_agent_not_found` — see `docs/architecture/BOSS_AGENT_AND_ROUTING.md`). This is the actual mechanism by which "a human must approve production changes" is enforced in a system with no synchronous blocking prompt available.

## Escalation transparency

Every escalation — auto-resolved or not — is reported back via `onEscalation`, recorded with its real reason, summary, and full candidate list, and surfaced honestly in the UI (Execution Logs, Recent Activity) rather than hidden behind an apparently-confident reply.

## Spreadsheet cleaning approval (a third, smaller approval gate)

`SpreadsheetCleaningApproval` implements the same "propose → human decides → only then write" shape for the Google Sheets cleaning capability — see `docs/database/DATA_MODEL.md` and `docs/integrations/INTEGRATIONS_REFERENCE.md`. Not gated by the `owner`/`viewer` RBAC check (that check is scoped specifically to `approveRemediation`/`rejectRemediation` capabilities) — **NOT VERIFIED IN CURRENT CODEBASE** whether any role restriction applies to approving a spreadsheet cleaning; confirm directly in its route handler before assuming parity with the remediation gate.

## Where to modify

- Remediation approval: `web/src/server/backend/remediation.ts`, RBAC gate in `rbac.ts`.
- Web development approval: `web/src/server/backend/web-development.ts`, approve/reject routes under `web/src/app/api/workspace/web-development/[id]/`.
- Spreadsheet cleaning approval: model `SpreadsheetCleaningApproval`; locate its route handler directly before modifying its authorization behavior.
- Never-auto-resolve reasons: `web/src/server/backend/approval.ts`.
