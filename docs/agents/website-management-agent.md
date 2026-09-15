# Website Management Agent

## 1. Agent name
Website Management Agent

## 2. Agent ID
`website-management-agent`

## 3. Mission
Manage ongoing website content and configuration changes through a connected CMS (WordPress).

## 4. Responsibilities (per spec)
Publish and update website content; manage pages and posts; coordinate with the SEO Content Agent for publishing generated content; manage basic site configuration via the CMS.

## 5. Scope
In chat, this agent is role-play only. A real WordPress integration (connect, publish, manage) exists in the codebase as a separate, real feature reached through Settings → Integrations, but is NOT VERIFIED IN CURRENT CODEBASE to be wired into this agent's chat replies.

## 6. Inputs
Per spec: a chat request to manage or publish website content. Separately, the real integration takes a WordPress site URL and OAuth or Application Password credentials, entered through the Integrations UI — not through this agent's chat identity.

## 7. Outputs
Role-play chat text describing what would be done. Separately, the real integration can produce an actual published or updated WordPress post or page once explicitly connected and used via the Integrations UI.

## 8. Tools/integrations actually used
None confirmed wired to this agent's own chat dispatch. A real, separate integration exists: `web/src/server/wordpress.ts`, `wordpress-com-oauth.ts`, and `web/src/app/api/integrations/wordpress/**` — confirmed real, including AES-256-GCM credential encryption (verified via direct import/call-site read of `wordpress.ts`) — but this is NOT VERIFIED IN CURRENT CODEBASE as reachable from this agent's chat dispatch path.

## 9. Data dependencies
`WordPressConnection` (Prisma) — used by the real Settings integration; not confirmed to be consumed by this agent's own dispatch code.

## 10. Communication/workflow relationships (per spec)
Receives from: SEO Content Agent, Boss Agent, Web Development Agent. Sends to: Boss Agent.

## 11. Upstream dependencies
The SEO Content Agent's real generated drafts, if a human chooses to publish them via the separate WordPress integration.

## 12. Downstream dependencies
None confirmed automated.

## 13. Human approval requirements
Per the system's global governance rules, publishing to a live site requires human approval — enforced at the WordPress integration layer (`wordpress.ts`), not by this agent's own (role-play) chat logic.

## 14. Security restrictions
WordPress credentials are encrypted at rest (AES-256-GCM, confirmed via direct import read of `wordpress.ts`). This protection applies to the real Settings integration regardless of whether this agent's chat identity is wired to it.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` guardrail against claiming a real publish action that the chat dispatch path did not actually perform.

## 16. Failure behavior
Standard role-play failure modes apply in chat. The separate real integration's failure behavior (invalid credentials, unreachable site, etc.) is documented in `technical/INTEGRATIONS_REFERENCE.md`.

## 17. Current implementation status
Role-play in chat; real, but reached only through the separate WordPress Settings integration — NOT VERIFIED IN CURRENT CODEBASE as wired into this agent's own chat dispatch.

## 18. Exact specification file path
`Agents/website-management-agent.md`

## 19. Exact implementation path
`src/agents/website-management-agent/` (root, no confirmed real web dispatch); `web/src/server/wordpress.ts`, `wordpress-com-oauth.ts` (real, separate integration); `web/src/app/api/integrations/wordpress/**` (real API routes)

## 20. Exact routing/dispatch location
No dedicated dispatch branch for `website-management-agent` was found in `web/src/app/api/workspace/messages/route.ts` — confirm directly if this changes. The real WordPress integration is reached through `web/src/app/api/integrations/wordpress/**` directly, independent of this agent's chat identity.

## 21. Related workflow(s)
None dedicated; related to `technical/workflows/CONTENT_GENERATION_WORKFLOW.md` as a manual, human-initiated next step after content generation.

## 22. How an admin changes its behavior
To wire real publishing into this agent's chat replies, add a dispatch branch in `messages/route.ts` calling into `wordpress.ts`'s real publish functions, gated by the same human-approval requirement already enforced for the standalone integration.

## 23. How a client interacts with it
A client can discuss website management in chat and receive advisory (role-play) text. To actually publish or manage WordPress content today, they must use the separate Settings → Integrations → WordPress flow.

## 24. Known limitations
This agent's chat identity and the real WordPress integration are not confirmed connected — a client asking this agent in chat to "publish this post" will not trigger a real publish. Recorded as an engineering follow-up for future verification/wiring.

## 25. Verification status
PARTIALLY VERIFIED — the real WordPress integration and its encryption are verified by direct code read; the chat-dispatch wiring for this specific agent ID is NOT VERIFIED IN CURRENT CODEBASE (no matching dispatch branch found).
