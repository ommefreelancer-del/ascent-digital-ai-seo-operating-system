# Competitor Intelligence Agent

## 1. Agent name
Competitor Intelligence Agent

## 2. Agent ID
`competitor-intelligence-agent`

## 3. Mission
Analyze competitors and identify ethical, data-driven opportunities to improve SEO performance.

## 4. Responsibilities (per spec)
Identify direct/indirect competitors; analyze competitor keywords; discover keyword/content gaps; analyze backlink profiles; review on-page/technical strengths; compare organic visibility; recommend ethical strategies; share insights with relevant agents.

## 5. Scope
Per its own documented contract, competitors are never discovered automatically and never fetched by this agent — the caller must supply real fetched HTML for each competitor plus a real audit/keyword-research result for "our" site.

## 6. Inputs
A user chat message containing a target URL (`extractUrl(message)`); a real `WebsiteAuditResult`/`TechnicalSeoResult`/`KeywordResearchResult` for the user's own site; real fetched HTML for each competitor the caller supplies.

## 7. Outputs
Competitor Intelligence Report, Keyword Gap Report, Content Gap Report, Backlink Opportunity Report, Strategic Recommendations — built from the real `CompetitorIntelligenceAgent.analyzeCompetitors()` class method.

## 8. Tools/integrations actually used
DataForSEO (shared credential) plus real HTTP fetches of competitor pages. Spec lists Ahrefs/SEMrush/Google Search generically — no confirmed Ahrefs/SEMrush API integration.

## 9. Data dependencies
NOT VERIFIED IN CURRENT CODEBASE for persistence of competitor-intelligence results specifically — likely embedded in the calling feature's own result rather than a dedicated table.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Keyword Research & Search Intent Agent, Website Audit Agent. Sends to: Boss Agent, SEO Strategy Agent, Content Strategy Agent, SEO Content Agent, Off-Page SEO Agent.

## 11. Upstream dependencies
Real `WebsiteAuditResult`/`KeywordResearchResult` for the user's own site (caller-supplied).

## 12. Downstream dependencies
`src/workflows/seo-audit-workflow.ts` step 11 (Competitor Analysis) — only runs if real competitor HTML is supplied.

## 13. Human approval requirements
None documented — read-only analysis of already-public competitor pages.

## 14. Security restrictions
Never fabricate competitor metrics or copy competitor content (spec Rules) — enforced by returning real data or an honest "no target URL supplied" message rather than a guess.

## 15. Anti-hallucination requirements
No valid current target URL → an honest request for one, never a guess. Missing competitor HTML → real, honest gap reporting rather than a fabricated comparison.

## 16. Failure behavior
See Anti-hallucination requirements — both missing-input cases are handled honestly, not fabricated.

## 17. Current implementation status
Real (dispatched). Genuine `CompetitorIntelligenceAgent` + `WebsiteAuditAgent` class execution against real fetched data — not LLM role-play for the analysis itself.

## 18. Exact specification file path
`Agents/competitor-intelligence-agent.md`

## 19. Exact implementation path
`src/agents/competitor-intelligence-agent/` (root class, rebuild via `npm run build`); `web/src/server/backend/competitor-intelligence.ts` (web bridge)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `COMPETITOR_INTELLIGENCE_AGENT_ID` branch, calls `runCompetitorIntelligence()`, real dispatch

## 21. Related workflow(s)
`src/workflows/seo-audit-workflow.ts` step 11

## 22. How an admin changes its behavior
Edit `web/src/server/backend/competitor-intelligence.ts` for orchestration logic; edit the root class in `src/agents/competitor-intelligence-agent/` (rebuild after edits).

## 23. How a client interacts with it
A client supplying their own site's URL plus explicit competitor URLs/HTML gets a real, data-grounded comparison; a bare "analyze my competitors" request with no target site and no competitor list surfaces as an honest data gap, not a fabricated report.

## 24. Known limitations
Cannot discover competitors on its own — a real, meaningful comparison depends entirely on what URLs/HTML the caller supplies.

## 25. Verification status
VERIFIED real, by direct code read of `competitor-intelligence.ts` and confirmed dispatch branch.
