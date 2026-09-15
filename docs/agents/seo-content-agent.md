# SEO Content Agent (Content Writing)

## 1. Agent name
SEO Content Agent

## 2. Agent ID
`seo-content-agent`

## 3. Mission
Create high-quality, original, SEO-optimized content that satisfies user intent, supports business goals, and improves organic search performance.

## 4. Responsibilities (per spec)
Write blog posts, guest posts, website/landing pages, product descriptions; write meta titles/descriptions; create FAQs; optimize for target keywords; maintain brand voice; coordinate with Content Strategy and On-Page SEO Agents.

## 5. Scope
The single most deeply real-code-backed agent in the system: real keyword research, real strategy, real Anthropic/Gemini-generated prose, real structural QA validation, real image attachment.

## 6. Inputs
`businessObjective`, a real `ContentStrategyResult`, a real `KeywordResearchResult`, optional `brandGuidelines`.

## 7. Outputs
A real `SeoContentResult`: one or more `ContentDraft`s (title, content type, target keyword, meta title/description, sections, FAQs, image recommendations, real attached Pixabay/Pexels images, a QA verdict/history, `generationStatus`, `publicationReady`, `limitations`).

## 8. Tools/integrations actually used
Anthropic API (primary) with Google Gemini as an explicit, opt-in billing-failure fallback (only retries on a genuine billing/credit/access failure, never on an unrelated error). Pexels for real article images.

## 9. Data dependencies
`ContentDraft` (Prisma), via the `/api/content` form path; the chat-triggered pipeline persists the same real result into the existing `ContentDraft` library.

## 10. Communication/workflow relationships (per spec)
Receives from: Content Strategy Agent, Keyword Research & Search Intent Agent, SEO Strategy Agent. Sends to: On-Page SEO Agent, Boss Agent.

## 11. Upstream dependencies
Real `ContentStrategyResult`, real `KeywordResearchResult`.

## 12. Downstream dependencies
On-Page SEO Agent (content-pipeline Stage 4, role-play, context-fed with this agent's real output); WordPress publishing (separate, human-approval-gated integration).

## 13. Human approval requirements
None documented for drafting; publishing generated content to a live site would trigger `GLOBAL_RULES.md` §9's approval requirement, enforced at the publishing integration layer (`wordpress.ts`), not by this agent itself.

## 14. Security restrictions
Real, billed API usage gated by configured keys only; the article-purity self-test is a hard technical gate that can block content generation entirely if it fails.

## 15. Anti-hallucination requirements
Never plagiarizes or copies competitor content, enforced by `validation/article-purity-validator.ts` — a structural gate that runs a self-test before every real generation; if the self-test itself fails, the pipeline refuses to configure a real, billed provider at all.

## 16. Failure behavior
A draft's `generationStatus` can be `"failed_validation"` if the purity validator finds real structural contamination — surfaced before the section content, never buried. An editorial QA self-check can independently flag issues with up to one automatic revision attempt; if the final re-check doesn't complete, the last known real verdict is shown.

## 17. Current implementation status
Real (dispatched) — nothing here is templated or fabricated by the web layer itself.

## 18. Exact specification file path
`Agents/seo-content-agent.md`

## 19. Exact implementation path
`src/agents/seo-content-agent/` (drafting/, providers/, validation/article-purity-validator.ts); `web/src/server/backend/content.ts` (real execution), `specialist-orchestrator.ts` (pipeline entry point)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `CONTENT_PIPELINE_ENTRY_AGENT_ID` (`=== "seo-content-agent"`), calls `runContentGenerationPipeline()`, which calls the real Keyword Research/Content Strategy/SEO Content classes directly (never role-play for these three stages).

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md`; dedicated `/content` form; `src/workflows/seo-audit-workflow.ts` step 15

## 22. How an admin changes its behavior
Edit `src/agents/seo-content-agent/drafting/*.ts` for drafting logic; edit `validation/article-purity-validator.ts` for anti-plagiarism validation; edit `web/src/server/backend/content.ts` for provider selection/fallback; edit `specialist-orchestrator.ts` for pipeline order.

## 23. How a client interacts with it
A client requesting content gets real, generated prose grounded in real keyword research and strategy — with a visible QA/validation verdict, and an explicit recommendation to verify originality/EEAT with a real external tool before publishing.

## 24. Known limitations
Content quality/originality depends on the article-purity validator and QA self-check catching every real problem — these are real, code-based checks, not a guarantee of perfect content; a flagged draft still requires human review before publishing.

## 25. Verification status
VERIFIED real, by direct code read of `content.ts`, `specialist-orchestrator.ts`, and the root drafting/validation modules.
