# Business Development Agent

## 1. Agent name
Business Development Agent

## 2. Agent ID
`business-development-agent`

## 3. Mission
Identify, qualify, and develop new business opportunities supporting sustainable agency growth and long-term client relationships.

## 4. Responsibilities (per spec)
Identify potential clients; qualify inbound/outbound leads; research target industries; develop client-acquisition strategies; prepare service proposals; recommend pricing; track sales opportunities; coordinate sales handoffs; support partnerships; monitor growth trends.

## 5. Scope
Spec describes a full business-development function; no confirmed real market-research tool, CRM write access, or proposal-generation pipeline exists.

## 6. Inputs
A chat message routed to `business-development-agent`; per spec: Business Goals, Market Research, Prospect Information, CRM Data, Service Portfolio.

## 7. Outputs
A Claude-written reply only.

## 8. Tools/integrations actually used
None confirmed. Spec lists HubSpot CRM, LinkedIn, Google Sheets, Notion, Email Platforms.

## 9. Data dependencies
None confirmed.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, AI CRM Agent. Sends to: Boss Agent, AI CRM Agent, Client Reporting Agent.

## 11. Upstream dependencies
None real.

## 12. Downstream dependencies
None real.

## 13. Human approval requirements
Per spec Rules: "Never make false promises to prospects" — no wired external action exists to gate.

## 14. Security restrictions
Standard `GLOBAL_RULES.md` prompt-embedded compliance only.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` no-side-effects/no-fabrication guardrail.

## 16. Failure behavior
Standard role-play failure modes (`AnthropicNotConfiguredError`, no-text-block error).

## 17. Current implementation status
Role-play (LLM only).

## 18. Exact specification file path
`Agents/business-development-agent.md`

## 19. Exact implementation path
`src/agents/business-development-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None — falls through to `generateSpecialistReply()`.

## 21. Related workflow(s)
None of the root workflow files.

## 22. How an admin changes its behavior
Edit `Agents/business-development-agent.md`. To make it real, build a dedicated backend bridge and chat-dispatch branch following the `campaign-tracking.ts`/`messages/route.ts` pattern.

## 23. How a client interacts with it
A client can chat about business-development strategy and get advisory text; no proposal, pricing document, or CRM record is actually generated or saved.

## 24. Known limitations
Purely conversational; no persisted pipeline tracking, proposal generation, or CRM sync currently exists.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` for a `BUSINESS_DEVELOPMENT_AGENT_ID` (no match found).
