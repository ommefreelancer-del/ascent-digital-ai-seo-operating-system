# Admin Agent

## 1. Agent name
Admin Agent

## 2. Agent ID
`admin-agent`

## 3. Mission
Manage administrative operations, documentation, internal records, and approvals; in its real, verified production capability, report real, account-scoped governance evidence (user access, RBAC model, client-data isolation, approval controls, audit-log evidence) for production security review.

## 4. Responsibilities (per spec)
Organize project documentation; maintain internal records; manage client onboarding documents; track contracts/agreements; maintain SOPs/templates; coordinate internal approvals; manage task/project status; archive completed projects; support compliance; assist Boss Agent with administrative tasks.

## 5. Scope
Real, verified scope: read-only, account-scoped governance/security evidence reporting. Spec-described scope (documents/SOPs/contracts/onboarding management) is broader than what is confirmed implemented — see Known Limitations.

## 6. Inputs
A chat message routed to `admin-agent` (e.g. asking about access, RBAC, audit logs, approval controls). System input: real evidence assembled by `buildGovernanceEvidenceContext()` from the requesting user's own account data only.

## 7. Outputs
A Claude-written reply, prefixed with real governance evidence text assembled from the database — never fabricated.

## 8. Tools/integrations actually used
No external third-party API. Reads directly from the application's own database (Prisma) — RBAC/permission records, approval records, audit-relevant tables.

## 9. Data dependencies
`User.role`, `RemediationApproval` status counts, `GitHubConnection`/`WordPressConnection`/`GoogleSearchConsoleConnection`/`Project` counts, `ActivityEvent` (including authorization denials), and real audit-log-file inspection (`var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`) — all scoped to the requesting account only.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, AI CRM Agent, Business Development Agent. Sends to: Boss Agent.

## 11. Upstream dependencies
None real beyond the requesting user's own session/account data.

## 12. Downstream dependencies
None — output is a chat reply only.

## 13. Human approval requirements
None for read-only governance reporting. Per `GLOBAL_RULES.md` §9, any real administrative action with production effect would require human approval — no such wired action exists for this agent today.

## 14. Security restrictions
Least-privilege, account-scoped queries only — no query path can return another account's data (matches the codebase-wide `userId` isolation convention).

## 15. Anti-hallucination requirements
Its spec explicitly requires reporting "real, account-scoped evidence only, never fabricated, never cross-account." The real evidence-assembly function never throws to the user — a query failure becomes an honest "could not verify" statement rather than an invented answer.

## 16. Failure behavior
If the governance-evidence query fails or the account has no relevant data, the codebase-wide anti-fabrication convention implies an honest report rather than a fabricated one — exact failure-path text NOT VERIFIED line-by-line in `admin-governance.ts`.

## 17. Current implementation status
Real (context-fed) for governance-evidence reporting. Role-play for the broader documentation/SOPs/contracts mission described in the spec — no confirmed backing implementation for that part.

## 18. Exact specification file path
`Agents/admin-agent.md`

## 19. Exact implementation path
`src/agents/admin-agent/` (root, depth not confirmed as used); real logic in `web/src/server/backend/admin-governance.ts`

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — matches `assignedAgentId === ADMIN_AGENT_ID`, calls `buildGovernanceEvidenceContext()` before `generateSpecialistReply()`

## 21. Related workflow(s)
None of the root workflow files reference this agent; reached only via direct chat routing.

## 22. How an admin changes its behavior
Edit `Agents/admin-agent.md` for tone/scope text. Edit `web/src/server/backend/admin-governance.ts` to change which real evidence is assembled or how it's presented. See `admin/MASTER_CHANGE_MAP.md`.

## 23. How a client interacts with it
A subscriber with account access can ask Admin Agent about their own account's security/governance posture (who has access, what roles exist, audit history) and get a real, evidence-based answer scoped to their own account only.

## 24. Known limitations
Only the governance-evidence-reporting capability is confirmed real; the broader "manage SOPs/contracts/onboarding docs" mission in the spec has no confirmed backing implementation — no dedicated Prisma model or backend module for SOPs/contracts/onboarding documents was found.

## 25. Verification status
PARTIALLY VERIFIED — governance-evidence path confirmed by direct code read of `admin-governance.ts`; broader document-management mission NOT VERIFIED.
