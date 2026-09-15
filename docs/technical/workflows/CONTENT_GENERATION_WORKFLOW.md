# Workflow: Content Generation

Classification: **Mixed** — see per-stage table below. Never described to a client as fully automatic tool execution; 3 of 5 visible sections are narration, not tool output.

## Purpose

Produce keyword research, SEO strategy, written content, on-page recommendations, and (conditionally) guest-posting ideas from one user request.

## Entry point / trigger

Automatic: starts whenever Boss Agent's routing decision assigns `seo-content-agent` in the chat path. Not a separately invoked "start pipeline" action.

## Required inputs

The user's chat message describing the desired content/topic.

## Step sequence, agent, classification, and data passed

| Stage | Agent | Classification | Data passed in |
|---|---|---|---|
| 1 | Keyword Research | **AUTOMATIC** (real) | The user's message |
| 2 | SEO Strategy | **RECOMMENDATION ONLY** (role-play) | User's message + Stage 1's real output (context-fed) |
| 3 | SEO Content | **AUTOMATIC** (real) | User's message + upstream context |
| 4 | On-Page SEO | **RECOMMENDATION ONLY** (role-play) | User's message + upstream context |
| 5 | Guest Posting (conditional) | **RECOMMENDATION ONLY** (role-play), only runs if `needsGuestPostingStage()` regex-matches the user's message | User's message + upstream context |

All five stages' output is combined into one reply presented as continuous numbered sections. The module's own code comment states directly: "Stages 2 (SEO Strategy), 4 (On-Page SEO), and 5 (Guest Posting) are separate specialists... and remain real `generateSpecialistReply()` calls" — an intentional, documented design, not an oversight.

## Approval gates

None — no stage in this pipeline makes a real production-affecting change.

## Integrations used

Real keyword/content generation logic in `content.ts`; optionally Google Gemini for the content section-writing seam (`GOOGLE_GEMINI_API_KEY`); Pexels for real-photo images in generated content.

## Outputs

A combined chat reply; real content additionally persisted.

## Persistence / storage

`ContentDraft` Prisma model (`type`: blog/landing-page/meta/social) for real generated content (Stages 1 and 3). Stages 2/4/5 output is not independently persisted as structured data — it exists only as chat message text (`ChatMessage.content`).

## Error handling

Real stages (1, 3) follow the codebase's standard honest-failure convention (a misconfigured provider throws a typed "not configured" error rather than fabricating output). Role-play stages fail the same way any LLM call fails (e.g. `AnthropicNotConfiguredError` if unconfigured).

## Logging / audit behavior

`[content-pipeline]` stage logging in `specialist-orchestrator.ts`.

## Completion criteria

All applicable stages (4 or 5, depending on the guest-posting regex match) return successfully and are concatenated into the final reply.

## What happens when a step is unavailable

**NOT VERIFIED IN CURRENT CODEBASE** whether a failure in one stage (e.g. Stage 1's real keyword generation throwing) aborts the entire pipeline or degrades gracefully to the remaining stages — confirm directly in `specialist-orchestrator.ts` before assuming either behavior.

## Exact implementation file(s)

`web/src/server/backend/specialist-orchestrator.ts` (orchestration), `web/src/server/backend/content.ts` (real Stage 1/3 logic).

## Exact documentation file(s)

This file; `agents/keyword-research-agent.md`; `agents/seo-strategy-agent.md`; `agents/seo-content-agent.md`; `agents/on-page-seo-agent.md`; `agents/guest-posting-digital-pr-agent.md`.
