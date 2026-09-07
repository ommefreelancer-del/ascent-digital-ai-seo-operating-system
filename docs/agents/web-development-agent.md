# Web Development Agent

## 1. Agent name
Web Development Agent

## 2. Agent ID
`web-development-agent`

## 3. Mission
Propose, draft, and — with explicit human approval — apply website code or content changes through a controlled GitHub-based pipeline.

## 4. Responsibilities (per spec)
Propose website changes; draft the implementation; await human approval; apply approved changes to the live repository; report status; support rollback where possible.

## 5. Scope
Deliberately does NOT call the frozen root `WebDevelopmentAgent` class described in the original agent spec. This is a separate, real web-layer implementation with its own plan → draft → approve → apply pipeline, gated by mandatory human approval before any change is written to a real repository.

## 6. Inputs
A user chat message describing a desired change, plus a connected GitHub repository (via OAuth).

## 7. Outputs
A real `WebDevelopmentChange` record (proposed plan, generated diff/draft, approval status, apply result); a real commit or pull request against the connected GitHub repository once approved.

## 8. Tools/integrations actually used
GitHub OAuth plus the GitHub REST/Git API (`web/src/server/github.ts`). The exact file-change scope for this agent's general pipeline, beyond the three remediation-specific operations (`robots.txt`, `sitemap.xml`, `index.html`) confirmed for the separate Audit Remediation pipeline, is NOT VERIFIED IN CURRENT CODEBASE — confirm directly in `web-development.ts`.

## 9. Data dependencies
`WebDevelopmentChange`, `GitHubConnection` (Prisma).

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Website Audit Agent, Technical SEO Agent. Sends to: Boss Agent.

## 11. Upstream dependencies
A connected GitHub account/repository; frequently triggered following an audit finding.

## 12. Downstream dependencies
None beyond the applied repository change itself.

## 13. Human approval requirements
Explicit, hard gate — every change must be approved before it is applied. Approval/rejection is handled at `web/src/app/api/workspace/web-development/[id]/approve` and `.../reject`, enforced via RBAC (`assertAuthorized`, owner-role only per `web/src/server/rbac.ts`).

## 14. Security restrictions
GitHub credentials are handled through the same account-scoped connection pattern used elsewhere in the system; RBAC is fail-closed and restricts approve/reject to the owner role. Whether GitHub credentials specifically use the AES-256-GCM `credential-encryption.ts` module (confirmed for WordPress and Google Search Console) is NOT VERIFIED IN CURRENT CODEBASE for `github.ts` — confirm directly if needed.

## 15. Anti-hallucination requirements
A change is only ever reported as "applied" after a real, confirmed GitHub API write; draft/proposed states are clearly distinguished from applied states in the UI and data model.

## 16. Failure behavior
A failed apply attempt surfaces the real GitHub API error rather than being silently reported as success. Whether an automatic rollback is implemented is NOT VERIFIED IN CURRENT CODEBASE — confirm directly in `web-development.ts`.

## 17. Current implementation status
Real (dispatched) — a real plan/draft/approve/apply pipeline, distinct from and not using the frozen root agent class of the same name.

## 18. Exact specification file path
`Agents/web-development-agent.md`

## 19. Exact implementation path
`src/agents/web-development-agent/` (frozen root class — NOT used by the web layer); `web/src/server/backend/web-development.ts` (the real implementation actually used)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `WEB_DEVELOPMENT_AGENT_ID` branch, calling `web-development.ts`'s plan/draft functions; approval endpoints at `web/src/app/api/workspace/web-development/[id]/approve` and `.../reject`.

## 21. Related workflow(s)
`technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md` is related but distinct — `remediation.ts` handles the narrow, robots.txt/sitemap.xml/canonical-only fast path, while this agent's pipeline is the broader, general-purpose code-change path.

## 22. How an admin changes its behavior
Edit `web/src/server/backend/web-development.ts` for plan/draft/apply logic; edit `web/src/server/github.ts` for GitHub API operations; edit `web/src/server/rbac.ts` to change who may approve or reject changes.

## 23. How a client interacts with it
A client with the owner role can request a website change, review the proposed draft, and explicitly approve or reject it before anything is written to the real repository; a viewer-role user cannot approve or reject.

## 24. Known limitations
Does not use the root `WebDevelopmentAgent` class documented in the original agent spec — a documentation-relevant naming/expectation mismatch, recorded in `technical/DOCUMENTATION_CONFLICTS.md`. Exact file-change scope beyond the three known remediation-specific operations, and rollback behavior, are NOT VERIFIED IN CURRENT CODEBASE.

## 25. Verification status
PARTIALLY VERIFIED — dispatch, the RBAC approval gate, and GitHub OAuth are confirmed by direct code read; full change-scope and rollback behavior are NOT VERIFIED IN CURRENT CODEBASE.
