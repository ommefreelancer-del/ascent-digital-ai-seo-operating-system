# SEO Strategy Agent

## 1. Agent name
SEO Strategy Agent

## 2. Agent ID
`seo-strategy-agent`

## 3. Mission
Develop comprehensive SEO strategies aligned with client business goals, guiding keyword, content, technical, and off-page priorities.

## 4. Responsibilities (per spec)
Analyze business goals and competitive landscape; define SEO priorities; set measurable targets; recommend strategic direction across keyword, content, technical, and off-page workstreams; coordinate with other specialist agents.

## 5. Scope
Role-play only; no independent chat-dispatch branch exists for this agent. It is reached solely as Stage 2 of the automatic 5-stage content-generation pipeline, and is explicitly confirmed role-play by `specialist-orchestrator.ts`'s own code comment.

## 6. Inputs
`businessObjective`; the real `KeywordResearchResult` produced by Stage 1; general conversational context supplied to the pipeline call.

## 7. Outputs
Claude-written SEO strategy text, shaped into an `SeoStrategyResult`-like object consumed in-memory by later pipeline stages — not independently persisted to its own table.

## 8. Tools/integrations actually used
None. Pure LLM synthesis grounded in the agent's spec file plus the real Stage 1 output.

## 9. Data dependencies
None confirmed as independently persisted; consumed only in-memory within `specialist-orchestrator.ts`'s pipeline run.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Performance & Analytics Agent, Competitor Intelligence Agent. Sends to: Content Strategy Agent, Keyword Research & Search Intent Agent, On-Page SEO Agent, Off-Page SEO Agent, Technical SEO Agent.

## 11. Upstream dependencies
Stage 1 Keyword Research Agent's real output (content-pipeline context only).

## 12. Downstream dependencies
Stage 3 SEO Content Agent (real) and Stage 4 On-Page SEO Agent (role-play) both receive this stage's text as pipeline context.

## 13. Human approval requirements
None — advisory strategy text only, not an action.

## 14. Security restrictions
None beyond standard prompt guardrails.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` guardrail; an explicit code comment in `specialist-orchestrator.ts` labels this stage as role-play, which prevents documentation or output from implying independent tool execution.

## 16. Failure behavior
Standard role-play failure modes. Pipeline-level behavior if the upstream Stage 1 call fails is NOT VERIFIED IN CURRENT CODEBASE beyond generic error handling — confirm directly in `specialist-orchestrator.ts` if precise behavior is needed.

## 17. Current implementation status
Role-play (context-fed), reachable only inside the 5-stage content-generation pipeline — no standalone chat dispatch.

## 18. Exact specification file path
`Agents/seo-strategy-agent.md`

## 19. Exact implementation path
`src/agents/seo-strategy-agent/` (root scaffold, no confirmed real web usage beyond pipeline text)

## 20. Exact routing/dispatch location
`web/src/server/backend/specialist-orchestrator.ts` — Stage 2, invoked inline from `runContentGenerationPipeline()`. No corresponding branch exists in `web/src/app/api/workspace/messages/route.ts`.

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit the Stage 2 prompt/logic inside `specialist-orchestrator.ts`. Making this agent real would require adding a dedicated dispatch branch and a real underlying data source (e.g., wiring to Search Console/DataForSEO data already used elsewhere in the system).

## 23. How a client interacts with it
A client requesting content generation implicitly receives this agent's strategic framing as part of the pipeline's internal Stage 2 output. It has no standalone chat identity a client can address directly outside the content-generation pipeline.

## 24. Known limitations
Not independently dispatchable in chat; produces advisory text only, not backed by live ranking or competitive data at this stage.

## 25. Verification status
VERIFIED role-play, by direct code read of `specialist-orchestrator.ts` (explicit code comment identifies Stage 2 as role-play).
