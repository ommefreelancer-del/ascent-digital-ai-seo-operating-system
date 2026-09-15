# Outreach Agent

## 1. Agent name
Outreach Agent

## 2. Agent ID
`outreach-agent`

## 3. Mission
Prepare personalized outreach communication for approved publishers and manage the outreach workflow.

## 4. Responsibilities (per spec)
Draft personalized outreach emails; prepare follow-up messages; track outreach status; record campaign progress; send results to Boss Agent.

## 5. Scope
Per spec Rules: prepare outreach only; do not send messages without human approval. Currently cannot send anything at all — see Known Limitations.

## 6. Inputs
Per spec: Qualified publishers, Contact records, Campaign requirements.

## 7. Outputs
Per spec: Outreach drafts, Follow-up schedule, Outreach status — currently as LLM-written text only.

## 8. Tools/integrations actually used
None confirmed. Gmail integration exists in this codebase (`web/src/server/gmail.ts`) but is not confirmed connected to this agent.

## 9. Data dependencies
None confirmed directly; real, persisted campaign status exists via the separate Campaign Tracking Agent (`CampaignRecord`), which notes "today, no web-layer Outreach Agent orchestration exists" to feed it real outreach results automatically.

## 10. Communication/workflow relationships (per spec)
Receives from: Contact Intelligence Agent. Sends to: Boss Agent.

## 11. Upstream dependencies
None real.

## 12. Downstream dependencies
Campaign Tracking Agent (`CampaignRecord`) — not currently fed real events from this agent.

## 13. Human approval requirements
Explicit, strong: do not send messages without human approval. No wired sending action exists to gate today, so this is currently satisfied by the agent having no send capability at all.

## 14. Security restrictions
None beyond standard prompt guardrails.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` guardrail against claiming a real send that didn't happen.

## 16. Failure behavior
Standard role-play failure modes.

## 17. Current implementation status
Role-play (LLM only).

## 18. Exact specification file path
`Agents/outreach-agent.md`

## 19. Exact implementation path
`src/agents/outreach-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None found.

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`

## 22. How an admin changes its behavior
To make this agent real (draft + approval-gated send), build a bridge using `web/src/server/gmail.ts` for sending, gated through the approval-channel pattern (`web/src/server/backend/approval.ts`) exactly like `web-development.ts`'s plan→approve→apply pattern, then feed the resulting real send event into `campaign-tracking.ts`.

## 23. How a client interacts with it
A client can request draft outreach copy and get LLM-written text, but no real email is ever sent by this agent today — every "outreach email" it produces is a draft only.

## 24. Known limitations
Cannot actually send anything today; the Campaign Tracking Agent has no real outreach events to track from this agent yet.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` (no matching dispatch ID found).
