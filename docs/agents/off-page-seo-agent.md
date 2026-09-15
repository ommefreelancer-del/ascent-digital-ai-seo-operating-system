# Off-Page SEO Agent

## 1. Agent name
Off-Page SEO Agent

## 2. Agent ID
`off-page-seo-agent`

## 3. Mission
Develop and manage ethical off-page SEO strategies that strengthen website authority, trust, and long-term organic growth.

## 4. Responsibilities (per spec)
Develop link-building strategies; identify backlink opportunities; recommend guest posting/link insertion; analyze competitor backlinks; monitor backlink quality/toxicity; identify disavow opportunities; support digital PR; identify local citations; recommend outreach; monitor referring domains.

## 5. Scope
The web-layer bridge deliberately does not construct or call the full `OffPageSeoAgent` class — that class's real `developOffPageStrategy()` requires a complete `CompetitorIntelligenceResult` and `WebsiteAuditResult`, neither of which chat currently gathers for a bare request. Building that full pipeline was explicitly out of scope for the fix that exists today.

## 6. Inputs
A user chat message routed to `off-page-seo-agent`.

## 7. Outputs
Real backlink-profile data (from DataForSEO) appended as context, then a Claude-written strategic reply.

## 8. Tools/integrations actually used
DataForSEO Backlinks API, via the real, already-tested `DataForSeoBacklinkDataProvider` (reads its own credentials from `process.env`).

## 9. Data dependencies
No dedicated persistence confirmed for this bridge; it is a stateless per-request enrichment.

## 10. Communication/workflow relationships (per spec)
Receives from: Competitor Intelligence Agent, SEO Strategy Agent, Boss Agent. Sends to: Performance & Analytics Agent, Boss Agent.

## 11. Upstream dependencies
None required beyond DataForSEO configuration.

## 12. Downstream dependencies
None confirmed.

## 13. Human approval requirements
None — read-only backlink data lookup and advisory reply.

## 14. Security restrictions
Explicit opt-in for real, billed DataForSEO calls (never fabricated data if not configured).

## 15. Anti-hallucination requirements
If `DATAFORSEO_LOGIN`/`PASSWORD` aren't configured, the provider returns `null` rather than fabricated data.

## 16. Failure behavior
The chat context reflects "not configured" honestly when the provider is unavailable.

## 17. Current implementation status
Real (context-fed) — a real backlink-data API call runs first (when configured); the final strategic reply is still Claude-written, grounded in that real data.

## 18. Exact specification file path
`Agents/off-page-seo-agent.md`

## 19. Exact implementation path
`src/agents/off-page-seo-agent/` (includes `providers/dataforseo-backlink-data-provider.ts`); `web/src/server/backend/off-page-seo.ts` (real bridge)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `OFF_PAGE_SEO_AGENT_ID` branch, calls `getBacklinkProfile()`/`buildOffPageSeoContext()` then `generateSpecialistReply()`

## 21. Related workflow(s)
None of the root workflow files directly.

## 22. How an admin changes its behavior
Edit `web/src/server/backend/off-page-seo.ts` for the real backlink-data bridge; configure DataForSEO credentials in `web/.env`. To wire the full strategic pipeline, build a bridge that first assembles a real `CompetitorIntelligenceResult` and `WebsiteAuditResult`, then calls the real `OffPageSeoAgent.developOffPageStrategy()` class method.

## 23. How a client interacts with it
A client asking for off-page SEO advice gets a reply grounded in real backlink data (if DataForSEO is configured) plus Claude's strategic synthesis — not the agent's full spec-described strategic analysis, which needs inputs chat doesn't currently gather.

## 24. Known limitations
Cannot run the agent's full, spec-described strategic analysis from a bare chat request — only real backlink-profile data is fetched and handed to Claude for a best-effort reply.

## 25. Verification status
VERIFIED real (context-fed), by direct code read of `off-page-seo.ts`.
