# Prospecting Agent

## 1. Agent name
Prospecting Agent

## 2. Agent ID
`prospecting-agent`

## 3. Mission
Discover relevant, high-quality websites matching a client's campaign requirements.

## 4. Responsibilities (per spec)
Find relevant websites; discover guest-posting/backlink opportunities; investigate a specific supplied URL (read-only) when given; remove duplicates; categorize prospects; assign a confidence level; forward results to Publisher Qualification Agent.

## 5. Scope
Never guesses, infers, or fabricates an email, date, author, URL, or other fact — reports "Not found"/"Not verifiable" instead. Never contacts publishers, never negotiates, never sends emails or submits forms.

## 6. Inputs
Campaign requirements/niche/country/language, or a specific user-supplied URL to investigate instead of a general discovery search.

## 7. Outputs
A prospect list with category, confidence, notes, an evidence URL/snippet per prospect (marked "not verified" when independent confirmation wasn't possible), an opportunistic public contact email when genuinely found, and — for a supplied URL — the most recent independently verifiable published article or an honest "Not found"/"Not verifiable" per field.

## 8. Tools/integrations actually used
Real, live Google search results via DataForSEO SERP; real, read-only page fetching to verify guest-post evidence and find recent articles/contact info across a bounded set of related pages.

## 9. Data dependencies
`Prospect` (Prisma) is the likely persistence target — NOT VERIFIED IN CURRENT CODEBASE for persisted prospect records beyond the in-request result; confirm directly in `prospecting.ts`.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent. Sends to: Publisher Qualification Agent.

## 11. Upstream dependencies
None required.

## 12. Downstream dependencies
Publisher Qualification Agent — hand-off NOT VERIFIED as automated (see that agent's own doc).

## 13. Human approval requirements
"Human approval is still required before any outreach or contact action later in the pipeline; this agent only researches and prepares verified opportunity data" (spec Rules) — this agent itself performs no action requiring approval.

## 14. Security restrictions
Real (non-Sandbox) SERP search calls are billed per-request and blocked by default even with valid DataForSEO credentials, requiring `DATAFORSEO_SERP_ALLOW_PRODUCTION=true` to explicitly enable.

## 15. Anti-hallucination requirements
Every unconfirmable fact is reported as "Not found"/"Not verifiable" rather than guessed.

## 16. Failure behavior
Sandbox mode (`DATAFORSEO_SANDBOX=true`) is available for cost-free testing with dummy data — never presented as real evidence.

## 17. Current implementation status
Real (dispatched). Genuine DataForSEO SERP calls and genuine, read-only HTTP fetches.

## 18. Exact specification file path
`Agents/prospecting-agent.md`

## 19. Exact implementation path
`src/agents/prospecting-agent/` (includes `providers/dataforseo-guest-post-discovery-provider.ts`); `web/src/server/backend/prospecting.ts` (real dispatch)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `PROSPECTING_AGENT_ID` branch, calls `runProspecting()`. Capability resolution uses the same `getSerpCapabilityStatus()` boolean the Settings → Integrations UI reads.

## 21. Related workflow(s)
`technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit `web/src/server/backend/prospecting.ts` for real discovery/dispatch logic; configure `DATAFORSEO_SANDBOX`/`DATAFORSEO_SERP_ALLOW_PRODUCTION` in `web/.env` for the cost/safety gate.

## 23. How a client interacts with it
A client can request prospect discovery for a niche and get a real, evidence-based list (with honest "not verifiable" markers where confirmation wasn't possible) — provided DataForSEO is configured and production SERP calls are explicitly allowed.

## 24. Known limitations
Real SERP-based discovery requires DataForSEO credentials and the explicit `DATAFORSEO_SERP_ALLOW_PRODUCTION=true` opt-in (or Sandbox mode for testing only, never real evidence).

## 25. Verification status
VERIFIED real, by direct code read of `prospecting.ts`.
