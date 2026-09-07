# Workflow: Guest Posting & Outreach

Classification: **Mixed** — see per-stage notes. Sending an outreach message is, by policy and by code, never automatic.

## Purpose

Identify, qualify, and reach out to guest-posting/PR prospects, then track campaign progress.

## Chain of agents (per spec)

Prospecting Agent → Publisher Qualification Agent → Contact Intelligence Agent → Outreach Agent → Reply & Negotiation Agent → Guest Posting & Digital PR Agent → Campaign Tracking Agent. A dedicated existing architecture doc covers Guest Posting & Digital PR Agent specifically: `docs/architecture/GuestPostingDigitalPRAgent.md` (pre-existing, preserved).

## Entry point / trigger

A user request for prospecting/outreach/guest-posting; also reachable as the optional Stage 5 of the content-generation pipeline (regex-triggered, role-play there — see `CONTENT_GENERATION_WORKFLOW.md`).

## Per-stage classification

| Stage | Classification | Notes |
|---|---|---|
| Prospecting | **AUTOMATIC** (real, persisted) | `Prospect` model — domain, qualification/outreach status. |
| Publisher Qualification | **NOT VERIFIED** whether real or role-play in chat dispatch | See `agents/publisher-qualification-agent.md`. |
| Contact Intelligence | **NOT VERIFIED** whether real or role-play in chat dispatch | See `agents/contact-intelligence-agent.md`. |
| Outreach (drafting) | Real drafting infrastructure exists; **sending is never automatic** | Per `GLOBAL_RULES.md` §9 and the `Prospect` schema comment: "only a human, via the app, ever actually sends an outreach message." |
| Reply & Negotiation | **NOT VERIFIED** whether real or role-play in chat dispatch | See `agents/reply-negotiation-agent.md`. |
| Guest Posting & Digital PR | **RECOMMENDATION ONLY** (role-play) in ordinary chat dispatch | Also the optional, regex-triggered Stage 5 of content generation (role-play there too). |
| Campaign Tracking | **AUTOMATIC** (real, persisted) | `CampaignRecord` model, one row per `(userId, campaignName)`. |

## Required inputs

A domain/prospect list or a request to find prospects for a niche.

## Data passed between steps

`Prospect` rows carry state between prospecting and outreach stages. Gmail is deliberately NOT the system of record — `gmailThreadId`/`gmailDraftId`/`gmailLastMessageId` are references only; real email content is always fetched live from Gmail, never duplicated into the database (confirmed directly in the `Prospect` model's schema comment).

## Approval gates

Sending an outreach email requires a human action in the app itself (not merely an "approval" data model — the send button itself is the control, per `GLOBAL_RULES.md` §9).

## Integrations used

Gmail (`server/gmail.ts`) for real thread/draft/message references; DataForSEO for real guest-post discovery data (`DataForSeoGuestPostDiscoveryProvider`, gated by `DATAFORSEO_SERP_ALLOW_PRODUCTION` for real, billed calls).

## Outputs

Qualified prospect list, drafted outreach messages (held for human send), campaign progress reports.

## Persistence / storage

`Prospect` (unique per `userId`+`domain`), `CampaignRecord` (unique per `userId`+`campaignName`, updated not duplicated on re-tracking).

## Completion criteria

`CampaignRecord.phase` reaches `in-progress`; `phase` deliberately never includes `"completed"` — the real agent has no data source to justify claiming a campaign finished (confirmed in the model's own schema comment).

## What happens when a step is unavailable

**NOT CURRENTLY IMPLEMENTED / NOT VERIFIED:** whether Publisher Qualification, Contact Intelligence, and Reply & Negotiation are wired into one continuous, chat-dispatched real pipeline the way SEO content-generation is — see `DOCUMENTATION_CONFLICTS.md` Unresolved 6. Treat each of those three stages as role-play unless independently reconfirmed via the `messages/route.ts` dispatch grep.

## Exact implementation file(s)

`web/src/server/backend/campaign-tracking.ts`, `web/src/server/gmail.ts`, `Prospect`/`CampaignRecord` in `web/prisma/schema.prisma`, `web/src/server/backend/specialist-orchestrator.ts` (guest-posting trigger).

## Exact documentation file(s)

This file; `agents/prospecting-agent.md`, `publisher-qualification-agent.md`, `contact-intelligence-agent.md`, `outreach-agent.md`, `reply-negotiation-agent.md`, `guest-posting-digital-pr-agent.md`, `campaign-tracking-agent.md`.
