# Reply & Negotiation Agent

## 1. Agent name
Reply & Negotiation Agent

## 2. Agent ID
`reply-negotiation-agent`

## 3. Mission
Manage publisher email conversations, negotiate pricing ethically, prepare professional replies, and obtain user approval before every outbound communication.

## 4. Responsibilities (per spec)
Read publisher replies; summarize conversations; extract quoted prices/terms; compare with target reseller pricing; prepare discount-request emails; generate follow-up negotiation emails; recommend strategies; present every reply for user approval; send only after approval; notify Boss Agent on agreement.

## 5. Scope
Per spec Rules: never send emails without user approval; never agree to pricing without user approval.

## 6. Inputs
Per spec: Publisher Replies, Outreach History, Target Pricing, Business Rules, User Instructions.

## 7. Outputs
Per spec: Conversation Summary, Negotiation Recommendations, Draft Reply Emails, Final Agreed Pricing, Negotiation Status Report — as LLM-written text only; no confirmed email-reading or sending integration for this agent.

## 8. Tools/integrations actually used
None confirmed. Spec lists Gmail, Email Platforms, Google Docs. Gmail integration exists in this codebase (`web/src/server/gmail.ts`) but is not confirmed connected to this agent.

## 9. Data dependencies
None confirmed.

## 10. Communication/workflow relationships (per spec)
Receives from: Outreach Agent, Boss Agent. Sends to: Google Sheets Integration Agent, AI CRM Agent, Boss Agent.

## 11. Upstream dependencies
None real.

## 12. Downstream dependencies
None real.

## 13. Human approval requirements
Explicit, strong: never send without approval, never agree to pricing without approval. No wired sending/agreement action exists to gate today.

## 14. Security restrictions
None beyond standard prompt guardrails.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` guardrail against claiming a real send or agreement that didn't happen.

## 16. Failure behavior
Standard role-play failure modes.

## 17. Current implementation status
Role-play (LLM only).

## 18. Exact specification file path
`Agents/reply-negotiation-agent.md`

## 19. Exact implementation path
`src/agents/reply-negotiation-agent/` (root, no confirmed real web usage)

## 20. Exact routing/dispatch location
None found.

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`

## 22. How an admin changes its behavior
To make this agent real, wire `web/src/server/gmail.ts` for reading/sending, gated through the approval-channel pattern (`web/src/server/backend/approval.ts`), and feed agreed pricing into `google-sheets-integration.ts`/AI CRM once those are real.

## 23. How a client interacts with it
A client can paste a publisher's reply into chat and get draft negotiation text back — it cannot actually read a real inbox or send a real reply today.

## 24. Known limitations
Cannot actually read a real publisher email reply or send a real negotiation email today — it can only produce draft text from whatever the user pastes into chat.

## 25. Verification status
VERIFIED as role-play only, by direct grep of `messages/route.ts` (no matching dispatch ID found).
