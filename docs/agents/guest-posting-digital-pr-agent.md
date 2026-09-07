# Guest Posting & Digital PR Agent

## 1. Agent name
Guest Posting & Digital PR Agent

## 2. Agent ID
`guest-posting-digital-pr-agent`

## 3. Mission
Streamline guest posting and digital PR by consolidating publisher records, campaign planning signals, outreach coordination status, and backlink placement tracking into one transparent view, operating exclusively under Boss Agent supervision.

## 4. Responsibilities (per spec)
Maintain a consolidated publisher database view; evaluate publisher quality/relevance; track outreach/negotiation progress per publisher; monitor confirmed placements; generate campaign planning/completion reports; escalate uncertainty.

## 5. Scope
Per spec Rules, explicitly excluded: never purchase guest posts automatically; never approve financial transactions; never negotiate pricing independently; never publish content without approval; never fabricate publisher metrics.

## 6. Inputs
When reached via the content pipeline: the user's message plus real upstream output from Keyword Research, SEO Strategy, SEO Content, and On-Page SEO stages.

## 7. Outputs
A Claude-written reply (role-play, using real upstream context as grounding) — one section of the combined content-pipeline reply.

## 8. Tools/integrations actually used
None confirmed dedicated to this agent beyond what the content pipeline already assembled.

## 9. Data dependencies
NOT VERIFIED IN CURRENT CODEBASE for standalone persistence; the root-layer implementation may maintain its own state — see the pre-existing `docs/architecture/GuestPostingDigitalPRAgent.md`.

## 10. Communication/workflow relationships (per spec)
Receives from: Prospecting Agent, Publisher Qualification Agent, Outreach Agent, Campaign Tracking Agent, Reply & Negotiation Agent, Boss Agent. Sends to: Boss Agent, Client Relationship Management Agent.

## 11. Upstream dependencies
Real upstream pipeline output (Keyword Research, SEO Strategy, SEO Content, On-Page SEO), when reached via the content pipeline.

## 12. Downstream dependencies
None confirmed real.

## 13. Human approval requirements
Strong, explicit spec-level requirements: never purchase, never negotiate pricing, never publish without approval. No wired transactional action exists in the pipeline stage to enforce this against (it only produces recommendations).

## 14. Security restrictions
"Maintain complete audit logs" (spec Rules) — not confirmed for the pipeline-stage execution specifically.

## 15. Anti-hallucination requirements
Spec Rules: never fabricate publisher metrics.

## 16. Failure behavior
Standard role-play failure modes (`AnthropicNotConfiguredError`, no-text-block error).

## 17. Current implementation status
Role-play, context-fed with real upstream pipeline output when reached via the content pipeline. Standalone chat routing directly to this agent ID would also be role-play with no special context.

## 18. Exact specification file path
`Agents/guest-posting-digital-pr-agent.md`

## 19. Exact implementation path
`src/agents/guest-posting-digital-pr-agent/` (root); architecture reference: `docs/architecture/GuestPostingDigitalPRAgent.md` (pre-existing)

## 20. Exact routing/dispatch location
No dedicated dispatch branch; reached only via `web/src/server/backend/specialist-orchestrator.ts` as content-pipeline stage 5, conditional on `needsGuestPostingStage()` regex-matching the user's message.

## 21. Related workflow(s)
`technical/workflows/CONTENT_GENERATION_WORKFLOW.md` (stage 5); `technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`; root `src/workflows/guest-posting-pipeline-workflow.ts` (NOT VERIFIED whether the web app exposes any route that triggers this file).

## 22. How an admin changes its behavior
Edit the trigger regex in `web/src/server/backend/specialist-orchestrator.ts` (`needsGuestPostingStage()`).

## 23. How a client interacts with it
Only reachable indirectly, as an optional final stage after requesting content generation with guest-posting language in the message — never runs on its own.

## 24. Known limitations
Never runs on its own in the chat pipeline; its substantial publisher-database/placement-tracking mission (per spec) has no confirmed real backing in the web layer today.

## 25. Verification status
VERIFIED as role-play (context-fed), by direct code read of `specialist-orchestrator.ts`.
