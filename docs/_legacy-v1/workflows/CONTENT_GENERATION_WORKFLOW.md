# Content Generation Workflow

Audience: admin / developer.

## Trigger

Automatically starts whenever Boss Agent's routing decision assigns `seo-content-agent` in the chat path. Not manually invoked as a separate "start pipeline" action — it is the standard behavior of that one agent ID.

## Implementation

`web/src/server/backend/specialist-orchestrator.ts`, orchestrating five stages:

| Stage | Agent | Mode | Notes |
|---|---|---|---|
| 1 | Keyword Research | **Real** | `content.ts`; real keyword/search-intent generation |
| 2 | SEO Strategy | Role-play | Context-fed with Stage 1's real output |
| 3 | SEO Content | **Real** | `content.ts`; real content generation |
| 4 | On-Page SEO | Role-play | — |
| 5 | Guest Posting | Role-play, conditional | Only runs if `needsGuestPostingStage()` matches the user's message via regex |

All five stages' output is combined into one reply, presented to the user as continuous sections (e.g. "## 2. SEO Strategy"). The module's own code comment is explicit that stages 2, 4, and 5 "remain real `generateSpecialistReply()` calls" — i.e., this is an intentional, documented design choice, not an oversight, but it does mean 3 of 5 visible sections in a "content generation" reply are LLM narration rather than tool-executed output.

## Real functions involved

- `getAgents()` (`content.ts`) — wires the real Keyword Research, Content Strategy, and SEO Content provider agents.
- `generateContent()`, `researchKeywordsAndGenerateContentFromMessage()`, `summarizeKeywordResearchForChat()`, `summarizeSeoContentForChat()`.

## Persistence

Real content output persists via the `ContentDraft` Prisma model (`type`: blog | landing-page | meta | social).

## Where to modify

- Pipeline stage order/logic: `web/src/server/backend/specialist-orchestrator.ts`.
- Real generation logic: `web/src/server/backend/content.ts`.
- Guest-posting trigger regex: `needsGuestPostingStage()` in `specialist-orchestrator.ts`.
- Database model: `ContentDraft` in `web/prisma/schema.prisma`.
- To make Stage 2/4/5 real: wire each to a genuine data source and a root-layer or new real-generation function, following the same pattern Stage 1/3 already use.
