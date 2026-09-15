# Google Business Profile Agent

## 1. Agent name
Google Business Profile Agent

## 2. Agent ID
`google-business-profile-agent`

## 3. Mission
Optimize and manage Google Business Profile (GBP) listings to improve local search visibility, customer engagement, and local business growth.

## 4. Responsibilities (per spec)
Optimize GBP listings; manage NAP consistency; optimize categories/attributes; publish Google Posts; monitor/respond to reviews; track local search performance; recommend citations; monitor competitor GBP activity; coordinate with Off-Page SEO and Performance & Analytics Agents.

## 5. Scope
A real GBP OAuth connector exists for account linking; this agent's own chat replies are not confirmed to use it.

## 6. Inputs
Per spec: Business Information, Website URL, Local SEO Strategy, Customer Reviews, Performance Data — in chat, a plain user message (role-play path).

## 7. Outputs
Per spec: GBP Optimization Report, Local SEO Recommendations, Review Management Report, Local Performance Report, Google Posts Plan — currently as LLM-written text only in chat.

## 8. Tools/integrations actually used
A real Google Business Profile OAuth connector exists (`web/src/server/google-business-profile.ts`, real `getConnectionStatus`/`listAccounts` confirmed via the integration health-check module), reachable via Settings → Integrations — not confirmed called from this agent's chat replies.

## 9. Data dependencies
The OAuth connection is persisted via `GoogleServiceConnection` (Prisma). NOT VERIFIED whether this agent's chat logic reads from it.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Off-Page SEO Agent, Performance & Analytics Agent. Sends to: Boss Agent, Client Reporting Agent.

## 11. Upstream dependencies
None confirmed real in chat.

## 12. Downstream dependencies
None confirmed real in chat.

## 13. Human approval requirements
Per `GLOBAL_RULES.md` §9, publishing content (e.g. a Google Post) would require human approval — no wired publish action exists to enforce this against currently.

## 14. Security restrictions
Follows Google's Business Profile policies per spec (prompt-level instruction, not a technical guardrail beyond the anti-fabrication system prompt).

## 15. Anti-hallucination requirements
Spec Rules: never creates fake reviews or misleading content. Standard `specialist-ai.ts` guardrail against claiming an unexecuted action.

## 16. Failure behavior
Standard role-play failure modes only, in chat.

## 17. Current implementation status
Role-play (LLM only) in chat. Real, separately, via the GBP OAuth integration for account connection — not confirmed connected to this agent's chat responses.

## 18. Exact specification file path
`Agents/google-business-profile-agent.md`

## 19. Exact implementation path
`src/agents/google-business-profile-agent/` (root); real connector: `web/src/server/google-business-profile.ts`

## 20. Exact routing/dispatch location
None found — standard Boss Agent scoring only.

## 21. Related workflow(s)
None of the root workflow files.

## 22. How an admin changes its behavior
Edit `Agents/google-business-profile-agent.md`. To wire real chat execution, add a `GOOGLE_BUSINESS_PROFILE_AGENT_ID` dispatch branch calling into a new bridge built on `google-business-profile.ts`, following the `performance-analytics.ts` context-fed pattern.

## 23. How a client interacts with it
A client can connect their real Google Business Profile via Settings → Integrations, but chatting with this agent will not currently act on that connection — treat any chat claim of having "posted," "updated," or "responded to a review" as not actually executed.

## 24. Known limitations
Significant gap between the real, working GBP OAuth connection and this agent's chat execution (role-play only) — the two are not confirmed connected.

## 25. Verification status
VERIFIED — chat path confirmed role-play by dispatch grep; real OAuth connector confirmed by direct code read of `google-business-profile.ts`.
