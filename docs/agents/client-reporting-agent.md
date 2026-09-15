# Client Reporting Agent

## 1. Agent name
Client Reporting Agent

## 2. Agent ID
`client-reporting-agent`

## 3. Mission
Prepare clear, accurate, professional client reports communicating SEO performance, completed work, business impact, and recommendations.

## 4. Responsibilities (per spec)
Generate monthly SEO reports; summarize completed activities; report ranking changes; report traffic/conversion trends; present KPI dashboards; explain results in client-friendly language; highlight achievements/challenges; recommend priorities; coordinate with Performance & Analytics Agent.

## 5. Scope
Two entirely separate execution realities exist for the same agent ID — see Current Implementation Status.

## 6. Inputs
Real entry point (`reporting.ts`): a real `WebsiteAuditResult`/`TechnicalSeoResult`/`PerformanceAnalyticsResult` assembled into a `ClientReportingResult`. Chat entry point: a plain user message (role-play only).

## 7. Outputs
Real entry point: a persisted `Report` row (Prisma) with real KPI/score data, optionally rendered as a downloadable PDF via `deliverables.ts`. Chat entry point: a Claude-written reply only.

## 8. Tools/integrations actually used
No direct third-party API of its own; consumes other agents' real results in the Reports pipeline.

## 9. Data dependencies
`Report` (Prisma, real, via the Reports pipeline). Not confirmed to persist anything from the plain chat path.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Performance & Analytics Agent, SEO Strategy Agent. Sends to: Boss Agent, Clients.

## 11. Upstream dependencies
Real: `WebsiteAuditAgent`, `TechnicalSeoAgent`, `PerformanceAnalyticsAgent` class outputs (Reports pipeline only).

## 12. Downstream dependencies
`Deliverable` (PDF generation, via `deliverables.ts`).

## 13. Human approval requirements
None documented specifically for report generation (read-only synthesis of already-real data).

## 14. Security restrictions
Report data should be scoped to the requesting account's own projects — exact scoping enforcement in `reporting.ts` NOT VERIFIED line-by-line, but matches the codebase-wide `userId` convention.

## 15. Anti-hallucination requirements
Spec Rules: never manipulate or fabricate metrics. Report generation should fail honestly (no report, or a partial report with limitations noted) rather than fabricate scores.

## 16. Failure behavior
NOT VERIFIED IN CURRENT CODEBASE beyond the general anti-fabrication convention.

## 17. Current implementation status
**Role-play (LLM only) in chat; Real via the dedicated Reports feature** (`web/src/app/api/reports/**`, which calls `reporting.ts` directly and does not go through Boss Agent routing at all). This is one of the clearest examples in the system of the same agent ID having two different execution realities depending on how it's reached.

## 18. Exact specification file path
`Agents/client-reporting-agent.md`

## 19. Exact implementation path
`src/agents/client-reporting-agent/` (root); `web/src/server/backend/reporting.ts` (real, non-chat entry point)

## 20. Exact routing/dispatch location
Chat: none — role-play only. Real path: `web/src/app/api/reports/**` (independent of Boss Agent routing).

## 21. Related workflow(s)
`technical/workflows/REPORTING_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit `web/src/server/backend/reporting.ts` for real report logic. To wire real chat dispatch, add a `CLIENT_REPORTING_AGENT_ID` branch in `messages/route.ts` calling into `reporting.ts` (context-fed or fully real, following existing patterns).

## 23. How a client interacts with it
Via the dedicated Reports feature in the app UI, a client gets a real, data-backed report. Asking the AI Workspace chat to "generate my monthly report" currently gets a role-played, non-real reply instead.

## 24. Known limitations
The real reporting capability exists but is only reachable through the dedicated Reports UI/API today, not through chat.

## 25. Verification status
VERIFIED — both execution paths confirmed by direct code read of `reporting.ts` and the absence of a chat-dispatch branch.
