# Campaign Tracking Agent

## 1. Agent name
Campaign Tracking Agent

## 2. Agent ID
`campaign-tracking-agent`

## 3. Mission
Track the progress and status of every outreach campaign from start to completion, including real, persisted, account-scoped campaign records.

## 4. Responsibilities (per spec)
Record campaign status; track outreach progress; monitor responses; update campaign records; generate campaign summaries; report to Boss Agent; persist real campaign records scoped to the requesting account only.

## 5. Scope
Tracks and persists campaign status only — does not itself run outreach (Outreach Agent's job, currently role-play — see Known Limitations).

## 6. Inputs
A user chat message (e.g. "what's the status of my outreach campaign"). System input: the real `CampaignTrackingAgent.trackCampaign()` class method, and any real `OutreachResult` already available.

## 7. Outputs
A real, persisted `CampaignRecord` row (Prisma); a Claude-written or template-based chat summary of the real record.

## 8. Tools/integrations actually used
No external third-party API. Uses the compiled root-layer `CampaignTrackingAgent` class.

## 9. Data dependencies
`CampaignRecord` (Prisma), scoped by `userId`.

## 10. Communication/workflow relationships (per spec)
Receives from: Outreach Agent. Sends to: Boss Agent.

## 11. Upstream dependencies
A real `OutreachResult`, when available — but "today, no web-layer Outreach Agent orchestration exists" to supply one automatically (per the module's own header comment), so this agent works only with what's genuinely supplied.

## 12. Downstream dependencies
Chat reply; `CampaignRecord` read by the Reporting workflow's `Deliverable.campaignRecordId` link.

## 13. Human approval requirements
None documented for read/track operations — not on `GLOBAL_RULES.md` §9's high-impact list.

## 14. Security restrictions
Account-scoped (`userId`) reads/writes only.

## 15. Anti-hallucination requirements
Per its own header comment, this bridge "never invents an `OutreachResult`" — when none is available, it says so rather than fabricate campaign activity.

## 16. Failure behavior
Honest absence of data reported rather than fabricated campaign activity; exact error surface beyond this NOT VERIFIED.

## 17. Current implementation status
Real (dispatched) — genuine agent-class execution plus genuine database persistence.

## 18. Exact specification file path
`Agents/campaign-tracking-agent.md`

## 19. Exact implementation path
`src/agents/campaign-tracking-agent/` (root class, rebuild via `npm run build`); `web/src/server/backend/campaign-tracking.ts` (web bridge)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `CAMPAIGN_TRACKING_AGENT_ID` branch, real dispatch (not role-play)

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md` (Campaign Tracking stage)

## 22. How an admin changes its behavior
Edit `web/src/server/backend/campaign-tracking.ts` for tracking/persistence logic; edit the `CampaignRecord` model in `web/prisma/schema.prisma` for data shape (requires `npm run db:migrate:dev`); edit the root class in `src/agents/campaign-tracking-agent/` (requires `npm run build` at repo root).

## 23. How a client interacts with it
A client can ask about a specific campaign's real, persisted status and get an accurate, database-backed answer — but the answer can only reflect outreach activity that was genuinely supplied to the system (e.g. manual entry), since Outreach Agent itself cannot yet send anything real.

## 24. Known limitations
Because no real Outreach Agent orchestration exists yet, campaign tracking cannot automatically observe outreach sent by the (currently role-play-only) Outreach Agent.

## 25. Verification status
VERIFIED real, by direct code read of `campaign-tracking.ts` and confirmed dispatch branch in `messages/route.ts`.
