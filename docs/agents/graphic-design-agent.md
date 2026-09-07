# Graphic Design Agent

## 1. Agent name
Graphic Design Agent

## 2. Agent ID
`graphic-design-agent`

## 3. Mission
Create professional, visually engaging, brand-consistent graphics for SEO, marketing, social media, websites, and business growth.

## 4. Responsibilities (per spec)
Design website graphics, blog featured images, social posts, YouTube thumbnails, infographics, marketing materials; maintain brand consistency; optimize for web performance; search and recommend real, royalty-free stock images/videos via the connected Pixabay integration.

## 5. Scope
Real, verified capability is stock-asset search and recommendation — not original artwork/image generation.

## 6. Inputs
A user chat message describing a visual/design need.

## 7. Outputs
Real Pixabay search results (images/videos) matched to the request, returned as recommendations — never a fabricated asset.

## 8. Tools/integrations actually used
Pixabay API (`PIXABAY_API_KEY`), via the shared `server/pixabay.ts` service — the same service the Graphic Design asset browser UI uses.

## 9. Data dependencies
None confirmed beyond the real-time Pixabay API call itself; no dedicated persistence model confirmed for design requests.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, SEO Content Agent, Content Strategy Agent. Sends to: Boss Agent, Website Management Agent.

## 11. Upstream dependencies
None real beyond the chat request itself.

## 12. Downstream dependencies
None confirmed.

## 13. Human approval requirements
None documented — recommending an already-licensed-for-use stock asset is not a high-impact action under `GLOBAL_RULES.md` §9.

## 14. Security restrictions
None beyond standard API-key configuration; `PIXABAY_API_KEY` is server-only.

## 15. Anti-hallucination requirements
Never hotlinks Pixabay assets — assets are downloaded through the platform before use. Results are real API hits, never fabricated.

## 16. Failure behavior
Not configured, rate-limited, a real API failure, or zero results are each surfaced honestly and distinctly — never silently substituted with a fabricated recommendation.

## 17. Current implementation status
Real (dispatched). A genuine Pixabay API call executes.

## 18. Exact specification file path
`Agents/graphic-design-agent.md`

## 19. Exact implementation path
`src/agents/graphic-design-agent/` (root); `web/src/server/backend/graphic-design.ts` (real dispatch); `web/src/server/pixabay.ts` (underlying client)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `GRAPHIC_DESIGN_AGENT_ID` branch. Required two fixes to work at all: a routing fix in `tag-weighted-routing-strategy.ts` (a `hasVisualAssetIntent` override, since visual-asset requests previously scored higher for `seo-content-agent`) and the dispatch branch itself.

## 21. Related workflow(s)
None of the root workflow files.

## 22. How an admin changes its behavior
Edit `web/src/server/backend/graphic-design.ts` for real dispatch logic; edit `src/boss-agent/routing/tag-weighted-routing-strategy.ts` for the visual-asset routing override (rebuild after edits).

## 23. How a client interacts with it
A client describing a visual need gets real, licensed stock-image/video recommendations — not an original, custom-generated graphic.

## 24. Known limitations
No original graphic creation, no Canva/Photoshop/Illustrator/Figma integration despite those tools being listed in the spec (described as tools a human designer might use, not automated integrations this agent calls).

## 25. Verification status
VERIFIED real, by direct code read of `graphic-design.ts` and the routing-fix comment trail.
