# Content Strategy Agent

## 1. Agent name
Content Strategy Agent

## 2. Agent ID
`content-strategy-agent`

## 3. Mission
Develop a data-driven content strategy aligning business goals, user search intent, and SEO best practices.

## 4. Responsibilities (per spec)
Develop SEO content strategies; create pillar pages/topic clusters; plan content silos/site architecture; prioritize content opportunities; build editorial calendars; recommend internal linking; identify content gaps; coordinate with SEO Content Agent; recommend content updates.

## 5. Scope
Has no standalone chat-dispatch branch of its own — never routed to directly by ID; runs for real only as an internal step of another entry point.

## 6. Inputs
Real: `businessObjective`, a real `KeywordResearchResult` from Keyword Research Agent, `articlesPerWeek`.

## 7. Outputs
A real `ContentStrategyResult` (topic clusters, content brief/outline) — consumed directly by SEO Content Agent's `developContent()` call.

## 8. Tools/integrations actually used
Anthropic API (outline generation, primary); Google Gemini as a real, explicit, opt-in billing-failure fallback, sharing a `GeminiRateLimiter` with SEO Content Agent's own Gemini provider.

## 9. Data dependencies
No direct persistence of its own — its result is embedded in whatever calls it (e.g. persisted as part of a content-generation result).

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Keyword Research & Search Intent Agent, Competitor Intelligence Agent, Website Audit Agent. Sends to: Boss Agent, SEO Content Agent, On-Page SEO Agent, SEO Strategy Agent.

## 11. Upstream dependencies
Real `KeywordResearchResult`.

## 12. Downstream dependencies
SEO Content Agent's `developContent()`; `src/workflows/seo-audit-workflow.ts` step 14 ("Content Brief Generation").

## 13. Human approval requirements
None — pure content-planning synthesis, no external side effects.

## 14. Security restrictions
None beyond standard `GLOBAL_RULES.md` prompt guidance; real provider calls are billed API usage, gated by configured API keys.

## 15. Anti-hallucination requirements
Real class execution and genuine LLM-backed outline generation — this closed an earlier defect where every content brief used an identical fixed six-heading template regardless of topic.

## 16. Failure behavior
If neither Anthropic nor Gemini succeeds, falls back to `FallbackOutlineGenerationProvider`'s degraded behavior. NOT VERIFIED exactly what that fallback produces beyond "never the old fixed six-heading template unless both real providers are unavailable."

## 17. Current implementation status
Real (embedded) — genuine class execution, not a fabricated template.

## 18. Exact specification file path
`Agents/content-strategy-agent.md`

## 19. Exact implementation path
`src/agents/content-strategy-agent/content-strategy-agent.ts` and `providers/` (rebuild via `npm run build`); web wiring in `web/src/server/backend/content.ts` (`getAgents()`)

## 20. Exact routing/dispatch location
Not routed to directly by Boss Agent under its own ID; reached only as an embedded step when Boss Agent assigns `seo-content-agent`, or via the dedicated `/content` form.

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md`; `src/workflows/seo-audit-workflow.ts` step 14

## 22. How an admin changes its behavior
Edit `src/agents/content-strategy-agent/content-strategy-agent.ts` and its `providers/` for strategy/outline logic (rebuild after edits); edit `content.ts`'s `FallbackOutlineGenerationProvider` construction for provider order/fallback behavior.

## 23. How a client interacts with it
A client cannot route a message specifically "to" Content Strategy Agent by ID; it surfaces only as part of the content-generation pipeline reply or the dedicated content form.

## 24. Known limitations
No independent existence in the chat UI.

## 25. Verification status
VERIFIED real, by direct code read of `content.ts` and root provider files.
