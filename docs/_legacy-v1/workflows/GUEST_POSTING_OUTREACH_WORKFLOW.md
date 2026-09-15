# Guest Posting & Outreach Workflow

Audience: admin / developer.

## Chain of agents (per spec / architecture doc)

Prospecting Agent → Publisher Qualification Agent → Contact Intelligence Agent → Outreach Agent → Reply & Negotiation Agent → Guest Posting & Digital PR Agent → Campaign Tracking Agent. A dedicated existing architecture doc already covers Guest Posting & Digital PR Agent specifically: `docs/architecture/GuestPostingDigitalPRAgent.md` (preserved, referenced here rather than duplicated).

## What is real vs. role-play in this chain

- **Prospecting** and the **Prospect** data model are real and persisted (`Prospect` Prisma model — domain, qualification status, outreach status, scheduling fields). Confirmed structured fields: `qualificationStatus` (pending/qualified/rejected), `outreachStatus` (not-contacted/drafted/sent/replied/follow-up-due/closed).
- **Gmail is deliberately not the system of record.** `Prospect` holds durable status/qualification/scheduling data; `gmailThreadId`/`gmailDraftId`/`gmailLastMessageId` are references only — real email content is always fetched live from Gmail, never duplicated into the database. This is stated directly in the schema's own comment on the `Prospect` model.
- Per `GLOBAL_RULES.md` §9 (referenced directly in the `Prospect` model's schema comment): **only a human, via the app, ever actually sends an outreach message.** The agents' real backend stops short of that step by design.
- **Guest Posting & Digital PR Agent's own chat execution mode:** role-play (LLM only) in ordinary chat dispatch; it is invoked automatically as an optional Stage 5 of the content-generation pipeline only when the user's message regex-matches `needsGuestPostingStage()` in `specialist-orchestrator.ts` (see `CONTENT_GENERATION_WORKFLOW.md`) — also role-play there.
- **Campaign Tracking** is real and persisted: `CampaignRecord` model, one row per `(userId, campaignName)`, updated (not duplicated) on re-tracking. Tracks `phase` (`not-started`|`in-progress` — `completed` is deliberately never stored, per the real agent's own rule that there is no real publisher-response data source to justify claiming completion), `totalApprovedPublishers`, `draftedCount`, `skippedCount`.

## Known limitation (recorded, not fixed)

The guest-posting/outreach pipeline is not confirmed to be automated end-to-end in the live web product the way the SEO content-generation pipeline is — several stages (Publisher Qualification, Contact Intelligence, Reply & Negotiation) exist as specs and root-layer classes but their real, chat-dispatched wiring into a single continuous pipeline was not independently confirmed in this documentation pass. See individual agent docs (`docs/agents/prospecting-agent.md`, `publisher-qualification-agent.md`, `contact-intelligence-agent.md`, `outreach-agent.md`, `reply-negotiation-agent.md`) for each stage's own confirmed execution mode.

## Where to modify

- Data model: `Prospect`, `CampaignRecord` in `web/prisma/schema.prisma`.
- Campaign tracking real logic: `web/src/server/backend/campaign-tracking.ts`.
- Gmail integration: `web/src/server/gmail.ts` (referenced in schema comments; confirm current path before editing).
- Guest posting trigger: `needsGuestPostingStage()` in `web/src/server/backend/specialist-orchestrator.ts`.
- Global send-restriction rule: `GLOBAL_RULES.md` §9.
