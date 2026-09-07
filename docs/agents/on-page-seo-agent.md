# On-Page SEO Agent

## 1. Agent name
On-Page SEO Agent

## 2. Agent ID
`on-page-seo-agent`

## 3. Mission
Optimize individual web pages' on-page elements (title tags, meta descriptions, headings, keyword placement, URL structure, internal linking, alt text, structured data) to improve relevance, UX, and rankings.

## 4. Responsibilities (per spec)
Covers both classic on-page optimization and internal linking/title/meta-description work — there is no separate "Internal Linking Agent" or "Meta Title/Description Agent" in the real `Agents/` directory, so this one real agent fills both roles.

## 5. Scope
Two entirely separate, unconnected execution realities exist for this agent — see Current Implementation Status.

## 6. Inputs
Chat pipeline: the user's message plus real upstream output from Keyword Research, SEO Strategy, and SEO Content stages. Audit-workflow path: the workflow's real primary target keyword.

## 7. Outputs
Chat pipeline: a Claude-written reply (role-play, grounded in real upstream context) — one section of the combined content-pipeline reply. Audit-workflow path: real recommendations from `OnPageSeoAgent.generateRecommendations()`.

## 8. Tools/integrations actually used
Spec lists Google Search Console, Screaming Frog, Ahrefs, SEMrush generically; not confirmed wired to either execution path.

## 9. Data dependencies
None confirmed for the pipeline-stage execution.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Website Audit Agent, Keyword Research & Search Intent Agent, Content Strategy Agent, SEO Strategy Agent, SEO Content Agent. Sends to: Technical SEO Agent, Performance & Analytics Agent, Boss Agent.

## 11. Upstream dependencies
Chat pipeline: real Keyword Research/SEO Strategy/SEO Content output. Audit workflow: the workflow's own real target keyword.

## 12. Downstream dependencies
None confirmed.

## 13. Human approval requirements
None — advisory only in the chat pipeline.

## 14. Security restrictions
None beyond standard prompt guardrails.

## 15. Anti-hallucination requirements
Spec Rules: never uses manipulative/keyword-stuffing tactics; avoids duplicate/thin content.

## 16. Failure behavior
Chat pipeline: standard role-play failure modes. Audit workflow: follows that workflow's own honest-skip convention.

## 17. Current implementation status
**Role-play** in the chat content pipeline (context-fed with real upstream data); **Real** when invoked inside the root-layer `seo-audit-workflow.ts`. These are two different, unconnected code paths.

## 18. Exact specification file path
`Agents/on-page-seo-agent.md`

## 19. Exact implementation path
`src/agents/on-page-seo-agent/` (root class, real when used by the audit workflow)

## 20. Exact routing/dispatch location
No dedicated chat dispatch branch; reached via `web/src/server/backend/specialist-orchestrator.ts` as content-pipeline stage 4.

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md` (stage 4, role-play); `src/workflows/seo-audit-workflow.ts` step 16 (real)

## 22. How an admin changes its behavior
Edit the pipeline-stage trigger/order in `specialist-orchestrator.ts`; edit the root class in `src/agents/on-page-seo-agent/` for the audit-workflow's real behavior (rebuild after edits).

## 23. How a client interacts with it
Not independently chat-routable as a real-executing agent — a standalone "optimize this page's on-page SEO" chat request (outside the content pipeline) gets a role-play reply with no real page analysis.

## 24. Known limitations
See Scope and Current Implementation Status.

## 25. Verification status
VERIFIED — both execution paths confirmed by direct code read of `specialist-orchestrator.ts` and `seo-audit-workflow.ts` references.
