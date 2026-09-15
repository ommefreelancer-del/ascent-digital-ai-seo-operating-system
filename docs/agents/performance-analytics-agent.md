# Performance & Analytics Agent

## 1. Agent name
Performance & Analytics Agent

## 2. Agent ID
`performance-analytics-agent`

## 3. Mission
Monitor, measure, and analyze SEO performance to provide data-driven insights for continuous optimization.

## 4. Responsibilities (per spec)
Monitor rankings/traffic; analyze Google Search Console and analytics data; monitor conversions/KPIs; measure CTR/impressions/position; monitor Core Web Vitals; generate performance reports; recommend priorities; analyze real Google Search Console and Bing Webmaster performance data specifically.

## 5. Scope
Bing Webmaster data is explicitly scoped: never a keyword-volume database or competitor intelligence — that remains DataForSEO's role.

## 6. Inputs
A user chat message; real connection status and, when connected, real query data (last 28 days by default) from Google Search Console and/or Bing Webmaster.

## 7. Outputs
Real performance data appended as context, then a Claude-written analysis/reply.

## 8. Tools/integrations actually used
Google Search Console API (`getConnectionStatus`, `getOrSelectPrimarySite`, `querySearchAnalytics`); Bing Webmaster API (`getConnectionStatus`, `getOrSelectPrimarySite`, `getQueryStats`, `getRankAndTrafficStats`).

## 9. Data dependencies
`GoogleSearchConsoleConnection`, `BingWebmasterConnection`/`BingOAuthState` (Prisma), read for the requesting account only.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Technical SEO Agent, On-Page SEO Agent, Off-Page SEO Agent, Website Audit Agent. Sends to: Boss Agent, SEO Strategy Agent, Content Strategy Agent.

## 11. Upstream dependencies
A real, connected Google Search Console and/or Bing Webmaster Tools account.

## 12. Downstream dependencies
None confirmed beyond the chat reply.

## 13. Human approval requirements
None — read-only analytics reporting.

## 14. Security restrictions
Account-scoped connection lookups only.

## 15. Anti-hallucination requirements
Four honest states, per the module's own documented convention: not connected / connected but unverified / connected+verified but no data yet / real data. Never fabricates a number in any of these states.

## 16. Failure behavior
See Anti-hallucination requirements.

## 17. Current implementation status
Real (context-fed). Live GSC/Bing API calls happen first; the final synthesis is Claude-written. This is the pattern-setting fix other context-fed agents (`google-sheets-integration.ts`, `off-page-seo.ts`, `admin-governance.ts`) explicitly mirror.

## 18. Exact specification file path
`Agents/performance-analytics-agent.md`

## 19. Exact implementation path
`src/agents/performance-analytics-agent/` (root); `web/src/server/backend/performance-analytics.ts` (real chat bridge); `web/src/server/google-search-console.ts`, `bing-webmaster.ts` (underlying connectors)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `PERFORMANCE_ANALYTICS_AGENT_ID` branch, calls `buildSearchConsoleContext()`/`buildBingWebmasterContext()` then `generateSpecialistReply()`

## 21. Related workflow(s)
`src/workflows/seo-audit-workflow.ts` step 6 (Performance Audit) — a separate, Lighthouse-based real path via `LighthousePerformanceDataProvider`, opt-in only (`includePerformanceAudit: true`), distinct from this chat bridge.

## 22. How an admin changes its behavior
Edit `web/src/server/backend/performance-analytics.ts` for the real chat bridge; connect/reconfigure Google Search Console and Bing Webmaster Tools via Settings → Integrations.

## 23. How a client interacts with it
A client with a connected Search Console or Bing Webmaster account gets real, current performance data in the reply; without a connection, the reply is grounded only in honest "not connected" text, never fabricated numbers.

## 24. Known limitations
Depends entirely on the account having connected Google Search Console and/or Bing Webmaster Tools. Real Core Web Vitals analysis is a separate, opt-in capability reached only through the SEO Audit Workflow, not this chat bridge.

## 25. Verification status
VERIFIED real (context-fed), by direct code read of `performance-analytics.ts`.
