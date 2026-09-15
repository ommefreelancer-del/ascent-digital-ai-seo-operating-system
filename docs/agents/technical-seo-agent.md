# Technical SEO Agent

## 1. Agent name
Technical SEO Agent

## 2. Agent ID
`technical-seo-agent`

## 3. Mission
Identify and help resolve technical SEO issues affecting crawlability, indexability, site speed, and overall technical health.

## 4. Responsibilities (per spec)
Run technical audits; check crawlability and indexability; analyze site speed and Core Web Vitals; check structured data, `robots.txt`, `sitemap.xml`, canonical tags, mobile-friendliness, and HTTPS/security; report and prioritize technical issues.

## 5. Scope
Real (dispatched), but folded into the exact same dispatch branch and real pipeline as the Website Audit Agent — there is no functionally separate technical-only execution path in the code today.

## 6. Inputs
A user chat message containing a target URL, and optionally a target keyword.

## 7. Outputs
The real `SeoAuditResult`'s technical findings (crawlability, indexability, structured data, page speed, mobile-friendliness, security), plus a Claude-written summary/prioritization appended in the chat reply.

## 8. Tools/integrations actually used
Google PageSpeed Insights/Lighthouse (`LighthousePerformanceDataProvider`); the real crawler/parser inside `website-audit.ts` that checks `robots.txt`, `sitemap.xml`, canonical tags, and structured data.

## 9. Data dependencies
`SeoAudit` (Prisma) — the same table used by the Website Audit Agent; no separate technical-only table exists.

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, Website Audit Agent. Sends to: Performance & Analytics Agent, Content Strategy Agent, Off-Page SEO Agent, Boss Agent.

## 11. Upstream dependencies
None required — can be invoked directly with a target URL.

## 12. Downstream dependencies
The Audit Remediation workflow (human-approval-gated) when actionable `robots.txt`/`sitemap.xml`/canonical issues are found.

## 13. Human approval requirements
None for the audit itself. Any resulting fix goes through the human-approval-gated Audit Remediation workflow, whose real scope is limited to `robots.txt` (replace_file), `sitemap.xml` (replace_file), and `index.html` (set_canonical_link) — verified via `github.ts`'s `REMEDIATION_OPERATIONS` map.

## 14. Security restrictions
Same production-audit considerations as the Website Audit Agent — real outbound HTTP requests are made to the target site and a bounded set of its subpages.

## 15. Anti-hallucination requirements
Findings are grounded entirely in real audit output; the chat-layer summary is generated only from that real data and never invents a finding.

## 16. Failure behavior
The standalone `/api/seo-audit` route distinguishes a 422 (crawl failure, message shown verbatim) from a 502 (unexpected error, logged server-side) — confirmed by direct code read. Whether the chat-dispatch path surfaces the identical distinction is NOT VERIFIED IN CURRENT CODEBASE.

## 17. Current implementation status
Real (dispatched) — shares its entire underlying pipeline (`website-audit.ts`) with the Website Audit Agent.

## 18. Exact specification file path
`Agents/technical-seo-agent.md`

## 19. Exact implementation path
`src/agents/technical-seo-agent/` (root spec/scaffold); `web/src/server/backend/website-audit.ts` (real shared execution)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — the dispatch condition is `assignedAgentId === WEBSITE_AUDIT_AGENT_ID || assignedAgentId === TECHNICAL_SEO_AGENT_ID`, both branches calling `runFullAudit()`; also used in `reporting.ts` and `src/workflows/seo-audit-workflow.ts` step 2.

## 21. Related workflow(s)
`technical/workflows/SEO_AUDIT_WORKFLOW.md`, `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit `web/src/server/backend/website-audit.ts` (shared with the Website Audit Agent) to change technical checks; PageSpeed/Lighthouse behavior is configured via `LighthousePerformanceDataProvider` and its opt-in flag in the audit workflow.

## 23. How a client interacts with it
A client can specifically ask for a "technical SEO audit" and receives the same real, data-backed audit produced for the general Website Audit Agent, with technical findings highlighted in the reply.

## 24. Known limitations
This is not a functionally separate agent from the Website Audit Agent at the code level — both agent IDs route to the same function. Documentation must not imply independent technical-only logic beyond what `website-audit.ts` actually performs; this is recorded in `technical/DOCUMENTATION_CONFLICTS.md`.

## 25. Verification status
VERIFIED real, by direct code read of `messages/route.ts`'s shared dispatch condition and `website-audit.ts`.
