# Contact Intelligence Agent

## 1. Agent name
Contact Intelligence Agent

## 2. Agent ID
`contact-intelligence-agent`

## 3. Mission
Collect accurate, publicly available contact information for qualified publishers.

## 4. Responsibilities (per spec)
Find public contact details; identify the best contact method; verify available information; prepare contact records; forward records to the Outreach Agent.

## 5. Scope
Per spec Rules: use only publicly available information; do not send emails/messages; do not guess missing information; forward verified records only.

## 6. Inputs
Per spec: Approved publishers, Campaign requirements.

## 7. Outputs
Per spec: Contact records, Contact method, Verification notes — currently as LLM-written text only.

## 8. Tools/integrations actually used
None confirmed dedicated to this agent. Note: the separate Prospecting Agent has a confirmed real, opportunistic contact-email-finding capability as part of its own site-investigation feature (`prospecting.ts`) — that is not this agent's execution.

## 9. Data dependencies
None confirmed.

## 10. Communication/workflow relationships (per spec)
Receives from: Publisher Qualification Agent. Sends to: Outreach Agent.

## 11. Upstream dependencies
None real — the Publisher Qualification → Contact Intelligence handoff is not confirmed automated.

## 12. Downstream dependencies
None real.

## 13. Human approval requirements
None beyond its own "do not contact publishers" restriction (research only).

## 14. Security restrictions
Publicly-available-information-only constraint is a spec-level (prompt) rule, not a technically enforced one as far as verified.

## 15. Anti-hallucination requirements
Spec Rules: do not guess missing information.

## 16. Failure behavior
Standard role-play failure modes.

## 17. Current implementation status
Role-play (LLM only).

## 18. Exact specification file path
`Agents/contact-intelligence-agent.md`

## 19. Exact implementation path
`src/agents/contact-intelligence-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None found.

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit `Agents/contact-intelligence-agent.md`. To make it real, consider reusing the page-fetching infrastructure already built for Prospecting Agent (`prospecting.ts`) rather than building a second one, then add chat dispatch.

## 23. How a client interacts with it
A client can ask this agent about a contact-research approach and get advisory text; no real web search or page fetch is performed for this specific agent.

## 24. Known limitations
No real web-search or page-fetch capability is confirmed wired to this agent — contrast with Prospecting Agent, which does have one for a related but distinct purpose.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` (no matching dispatch ID found).
