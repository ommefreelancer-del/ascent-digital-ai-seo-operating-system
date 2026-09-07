# Publisher Qualification Agent

## 1. Agent name
Publisher Qualification Agent

## 2. Agent ID
`publisher-qualification-agent`

## 3. Mission
Evaluate discovered websites and determine whether they meet the client's campaign requirements.

## 4. Responsibilities (per spec)
Review prospect websites; verify relevance to target niche; check quality against campaign requirements; accept/reject prospects; forward approved prospects to Contact Intelligence Agent.

## 5. Scope
Per spec Rules: evaluate only; do not contact publishers; base decisions on available evidence; forward only qualified prospects.

## 6. Inputs
Per spec: Prospect list (from Prospecting Agent), Campaign requirements, Target niche, User instructions.

## 7. Outputs
Per spec: Approved prospects, Rejected prospects, Qualification notes — currently as LLM-written text only.

## 8. Tools/integrations actually used
None confirmed dedicated to this agent — it would logically consume the real evidence Prospecting Agent already gathered rather than re-fetching independently, but this hand-off is NOT VERIFIED as an automated pipeline.

## 9. Data dependencies
None confirmed.

## 10. Communication/workflow relationships (per spec)
Receives from: Prospecting Agent. Sends to: Contact Intelligence Agent.

## 11. Upstream dependencies
Prospecting Agent's real output — hand-off not automated (no dispatch bridge chains it in).

## 12. Downstream dependencies
Contact Intelligence Agent — hand-off not automated.

## 13. Human approval requirements
None — evaluation only, no contact action.

## 14. Security restrictions
None beyond standard prompt guardrails.

## 15. Anti-hallucination requirements
Spec Rules: base decisions on available evidence, not assumption.

## 16. Failure behavior
Standard role-play failure modes.

## 17. Current implementation status
Role-play (LLM only).

## 18. Exact specification file path
`Agents/publisher-qualification-agent.md`

## 19. Exact implementation path
`src/agents/publisher-qualification-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None found — reached independently, not automatically chained after Prospecting Agent.

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`

## 22. How an admin changes its behavior
To automate the pipeline, build a bridge that takes Prospecting Agent's real, structured output as typed input (following the `WorkflowContext` pattern in `workflows/Protocols/agent-communication-protocol.md`) and add chat dispatch for `PUBLISHER_QUALIFICATION_AGENT_ID`.

## 23. How a client interacts with it
A client can ask this agent to evaluate a described prospect and get advisory text, but a real prospect list from Prospecting Agent does not automatically flow into this agent's evaluation today.

## 24. Known limitations
The guest-posting pipeline (Prospecting → Publisher Qualification → Contact Intelligence → Outreach → Reply & Negotiation → Campaign Tracking → Guest Posting & Digital PR) is not automated end-to-end — only Prospecting Agent (and, separately, Campaign Tracking) have confirmed real chat-dispatch execution.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` (no matching dispatch ID found).
