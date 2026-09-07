# AI CRM Agent

## 1. Agent name
AI CRM Agent

## 2. Agent ID
`ai-crm-agent`

## 3. Mission
Manage client, prospect, and outreach data to maintain an organized CRM system supporting sales, SEO campaigns, and long-term client relationships.

## 4. Responsibilities (per spec)
Manage client/prospect records; track leads through the sales pipeline; organize outreach history; maintain campaign records; track follow-ups; identify inactive clients/prospects; generate CRM reports; coordinate with Outreach and Business Development Agents.

## 5. Scope
Spec describes a full CRM management system; no confirmed real CRM database, sync mechanism, or dedicated backend module exists in `web/src/server/backend/`.

## 6. Inputs
A chat message routed to `ai-crm-agent`; per spec: Client Information, Prospect Information, Outreach Activities, Campaign Updates, Business Requirements.

## 7. Outputs
A Claude-written reply only — no persisted CRM update is currently wired.

## 8. Tools/integrations actually used
None confirmed. Spec lists Google Sheets, Airtable, HubSpot CRM, Notion — none have a confirmed code-level integration for this specific agent (Google Sheets has a real integration in this codebase, but it is wired to the separate `google-sheets-integration-agent`, not this one).

## 9. Data dependencies
None confirmed — no Prisma model is written to by this agent (client/prospect data lives in `Prospect`/`Project`, but no evidence ties this agent to them).

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Business Development Agent, Outreach Agent. Sends to: Boss Agent, Client Reporting Agent.

## 11. Upstream dependencies
None real.

## 12. Downstream dependencies
None real.

## 13. Human approval requirements
Per spec Rules: "Never delete important records without approval." No wired deletion capability exists to enforce this against today.

## 14. Security restrictions
Standard `GLOBAL_RULES.md` compliance instructions embedded in its system prompt; no agent-specific technical restriction beyond that.

## 15. Anti-hallucination requirements
`specialist-ai.ts`'s hardcoded guardrail forbids claiming a real action (e.g. "I've updated the CRM") was taken when none was.

## 16. Failure behavior
Standard role-play failure modes: `AnthropicNotConfiguredError` if `ANTHROPIC_API_KEY` is unset; a thrown error if Claude returns no text block.

## 17. Current implementation status
Role-play (LLM only). No dispatch branch in `messages/route.ts` references this agent ID.

## 18. Exact specification file path
`Agents/ai-crm-agent.md`

## 19. Exact implementation path
`src/agents/ai-crm-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None — falls through to `generateSpecialistReply()`.

## 21. Related workflow(s)
None of the root workflow files reference it.

## 22. How an admin changes its behavior
Edit `Agents/ai-crm-agent.md` to change its role-play tone/scope. To make it real, build a dedicated `web/src/server/backend/ai-crm.ts` bridge (the `campaign-tracking.ts` pattern is the closest real precedent) and add a chat-dispatch branch for `AI_CRM_AGENT_ID` plus any needed Prisma model.

## 23. How a client interacts with it
A client can chat with this agent about CRM organization and get advisory text, but should not expect any actual record to be created, updated, or persisted — this agent currently cannot save anything.

## 24. Known limitations
Purely conversational; no real CRM persistence exists despite the spec describing a full CRM management mission. Any "I've updated the CRM" style claim is not real.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` for `AI_CRM_AGENT_ID` (no match found).
