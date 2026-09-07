# Keyword Research & Search Intent Agent

## 1. Agent name
Keyword Research & Search Intent Agent

## 2. Agent ID
`keyword-research-agent`

## 3. Mission
Identify high-value keywords and accurately analyze user search intent to support SEO strategy, content planning, and organic growth.

## 4. Responsibilities (per spec)
Comprehensive keyword research; identify primary/secondary/long-tail keywords; analyze search intent; evaluate difficulty/volume; discover gaps; group into topic clusters; prioritize by business goals; share insights with relevant agents.

## 5. Scope
Real, verified real-code execution — one of the most fully wired agents in the system.

## 6. Inputs
`businessObjective` and `seedKeywords` (in chat, the user's message doubles as both).

## 7. Outputs
A real `KeywordResearchResult`: classified keywords (with intent + rationale), real metrics when available (`metricsAvailable` flag, never estimated), topic clusters, limitations, a ranking disclaimer.

## 8. Tools/integrations actually used
DataForSEO Keyword Data API (shared credentials with Off-Page SEO and Prospecting Agents).

## 9. Data dependencies
Embedded into whatever calls it (e.g. `ContentDraft`/`SeoContentResult` persistence); no dedicated standalone table for keyword-research runs confirmed. `SavedKeyword` exists for a related but distinct feature — NOT VERIFIED whether this agent writes to it directly.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Competitor Intelligence Agent. Sends to: SEO Strategy Agent, Content Strategy Agent, SEO Content Agent, On-Page SEO Agent, Boss Agent.

## 11. Upstream dependencies
None required beyond the user's request.

## 12. Downstream dependencies
Content Strategy Agent, SEO Content Agent, SEO Strategy Agent (content-pipeline Stage 2, context-fed with this agent's real output).

## 13. Human approval requirements
None — read-only research, no external side effects.

## 14. Security restrictions
None beyond DataForSEO credential configuration (server-only env vars).

## 15. Anti-hallucination requirements
`DataForSeoKeywordDataProvider` returns `null` (never a fabricated metric) when credentials aren't configured, a production call isn't explicitly allowed, or the real API call fails for any reason.

## 16. Failure behavior
When no keyword data provider is configured, `metricsAvailable` is `false` and the chat summary explicitly states volume/difficulty are honestly unavailable, never estimated.

## 17. Current implementation status
Real (dispatched) — genuine agent-class execution against a real (or honestly absent) DataForSEO data source.

## 18. Exact specification file path
`Agents/keyword-research-agent.md`

## 19. Exact implementation path
`src/agents/keyword-research-agent/keyword-research-agent.ts` and `providers/dataforseo-keyword-data-provider.ts` (rebuild via `npm run build`); web wiring in `web/src/server/backend/content.ts`

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `KEYWORD_RESEARCH_AGENT_ID` (standalone, real) or reached as Stage 1 whenever `seo-content-agent` is assigned instead.

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md` (Stage 1); `src/workflows/seo-audit-workflow.ts` step 12

## 22. How an admin changes its behavior
Edit `src/agents/keyword-research-agent/keyword-research-agent.ts` and its provider (rebuild after edits); configure `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`/`DATAFORSEO_SANDBOX` in `web/.env`.

## 23. How a client interacts with it
A client can ask for keyword research directly and get a real, DataForSEO-grounded result when credentials are configured, or an honest "volume/difficulty unavailable" result otherwise — intent classification and clustering remain available either way.

## 24. Known limitations
Keyword volume/difficulty data depends entirely on a configured, billed DataForSEO connection.

## 25. Verification status
VERIFIED real, by direct code read of `content.ts` and the root provider.
