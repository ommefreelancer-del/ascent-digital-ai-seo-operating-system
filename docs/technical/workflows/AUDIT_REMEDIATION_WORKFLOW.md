# Workflow: Technical Remediation

Classification: **HUMAN APPROVAL REQUIRED** for the execute step. This is one of only two pipelines in ADASOS that makes a real, production-affecting change (the other is the Web Development change pipeline — see `agents/web-development-agent.md`).

## Purpose

Turn a diagnosed technical SEO finding into a real, approved fix committed to a connected GitHub repository.

## Entry point / trigger

Follows a Website Audit finding, or a direct request to fix a known issue, routed to the remediation pipeline via `follow-up-routing.ts` continuity or direct intent.

## Lifecycle

```
DIAGNOSE -> PLAN -> APPROVAL (human, required) -> EXECUTE -> DEPLOY -> VERIFY -> RESOLVED
```

Implemented across `web/src/server/backend/remediation.ts`, `remediation-actions.ts`, and the root `src/boss-agent/remediation/remediation-orchestrator.ts`.

## Exact real scope (confirmed by direct code read of `web/src/server/github.ts`)

`REMEDIATION_OPERATIONS` is a `ReadonlyMap` with **exactly three entries**:

| Affected resource | Operation |
|---|---|
| `robots.txt` | `replace_file` |
| `sitemap.xml` | `replace_file` |
| `index.html` | `set_canonical_link` |

Any other affected resource is rejected outright with a `NOT_REMEDIABLE` result — the adapter's own message: "outside this adapter's approved remediation scope (allowed: this deployment's own origin-root robots.txt, its own origin-root sitemap.xml, or its own homepage's canonical link)." A `NOT_REMEDIABLE` finding is recorded with `status: "not_remediable"` and a 100-year `expiresAt` — a deliberate, permanent "won't do" record so the same out-of-scope finding isn't re-proposed repeatedly.

## Approval gate — the critical control point

- Persisted as `RemediationApproval` (Prisma): `status` moves `pending -> approved|rejected|expired -> resolved|failed`.
- **Bound to a specific `connectionId`**, re-validated at decision time — a connection swapped in between is refused, never silently executed against a different repository/credential.
- **Time-bounded** (`expiresAt`, a real `APPROVAL_TTL_MS` constant in `remediation.ts`) — confirmed logic explicitly distinguishes a `pending`-but-past-`expiresAt` row from an already-`expired`-status row, both treated as not actionable.
- The exact proposed change (`proposedAction`) is shown verbatim before the decision and reused unmodified at execution.
- **RBAC enforcement (confirmed):** `remediation.ts` imports `assertAuthorized` from `web/src/server/rbac.ts` and calls it before allowing an approve/reject decision — only the `"owner"` role may decide; a `"viewer"` attempt is denied and logged as an `ActivityEvent` (`category: "authorization"`).
- `WebApprovalChannel` never auto-resolves a `deploy_production_change` escalation — always requires a real human decision, even in this non-interactive context.

## Step sequence

1. DIAGNOSE — a finding from a Website Audit (or equivalent) identifies an affected resource.
2. PLAN — the adapter checks the resource against `REMEDIATION_OPERATIONS`; out-of-scope resources are recorded `not_remediable` and stop here.
3. APPROVAL — a `RemediationApproval` row is created (`pending`), shown to the human with the exact proposed change.
4. EXECUTE — on `approved` (RBAC-checked), the real GitHub write happens (`replace_file` or `set_canonical_link`).
5. DEPLOY — a real GitHub Pages deployment may be triggered.
6. VERIFY — `doctor-flow.ts`'s `runFullReAudit()` runs a second real audit against the same URL, producing a real before/after comparison — only after a genuine execution attempt (`resolved`/`failed`/`failed_with_rollback`/`rollback_failed`), never after a merely-pending or rejected approval.
7. RESOLVED — final status recorded.

## Data passed between steps

Real Prisma rows (`RemediationApproval`, then `RemediationExecutionRecord`) carry state between steps — not in-memory handoff, since a human decision can happen much later than the diagnosis.

## Integrations used

GitHub API (`web/src/server/github.ts`), the real crawler/Lighthouse pipeline (verification step, via `website-audit.ts`).

## Outputs

A real repository commit (on approval), a `RemediationExecutionRecord` with `commitReference`/`deploymentReference`/`verificationReference`/`rollbackReference`.

## Persistence / storage

`RemediationApproval`, `RemediationExecutionRecord` (Prisma).

## Error handling

A rollback path exists (`rollback_failed` as a distinct recorded state) — confirms rollback is attempted on certain failures, though the exact rollback trigger conditions were not exhaustively traced in this pass.

## Logging / audit behavior

Real database audit trail via the two Prisma models above, plus the codebase-wide `AuditLogger`/`ActivityEvent` conventions.

## Completion criteria

`finalStatus` reaches `resolved` (or a terminal failure state) on `RemediationExecutionRecord`.

## What happens when a step is unavailable

No active/authorized GitHub connection → the pipeline cannot reach EXECUTE; the finding stays diagnosed with no approval created, or an approval is created but cannot be acted on (surfaced honestly, never fabricated).

## Exact implementation file(s)

`web/src/server/backend/remediation.ts`, `remediation-actions.ts`, `web/src/server/github.ts`, `web/src/server/backend/doctor-flow.ts`, `web/src/server/rbac.ts`, `src/boss-agent/remediation/remediation-orchestrator.ts`.

## Exact documentation file(s)

This file; `agents/website-audit-agent.md`; `technical/AUTH_AND_RBAC.md`.
