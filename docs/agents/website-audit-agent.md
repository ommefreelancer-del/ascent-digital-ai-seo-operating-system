# Website Audit Agent

## 1. Agent name
Website Audit Agent

## 2. Agent ID
`website-audit-agent`

## 3. Mission
Perform comprehensive, real website audits covering technical SEO, content, and on-page factors, and drive re-audits after remediation.

## 4. Responsibilities (per spec)
Crawl and audit a target site; check technical SEO health, on-page factors, and content quality signals; produce a scored, prioritized findings report; support re-auditing after fixes are applied.

## 5. Scope
The most broadly reused real pipeline among the 27 agents: the same `runFullAudit()` function backs the chat dispatch, the standalone `/api/seo-audit` route, the Audit Remediation workflow's DIAGNOSE step, and the doctor-flow re-audit loop.

## 6. Inputs
A target URL and, optionally, a target keyword — supplied via chat or the dedicated audit form.

## 7. Outputs
A real `SeoAuditResult` persisted as `SeoAudit` (score, findings, technical/on-page/content sections); `ProjectActivity`/`ActivityEvent` records; a Claude-written summary appended to chat responses.

## 8. Tools/integrations actually used
Real site crawling/fetching; Google PageSpeed Insights/Lighthouse for performance data. Any additional DataForSEO usage inside this specific pipeline beyond what is already verified elsewhere is NOT VERIFIED IN CURRENT CODEBASE — confirm directly in `website-audit.ts` if precise tool usage is needed.

## 9. Data dependencies
`SeoAudit`, `RemediationApproval`, `RemediationExecutionRecord` (Prisma).

## 10. Communication/workflow relationships (per spec)
Receives from: Boss Agent, direct client request. Sends to: Technical SEO Agent, On-Page SEO Agent, Performance & Analytics Agent, Web Development Agent (via remediation), Boss Agent.

## 11. Upstream dependencies
None required — can be invoked directly with a URL.

## 12. Downstream dependencies
The Audit Remediation workflow's DIAGNOSE step consumes this agent's real output directly; follow-up routing is handled by `follow-up-routing.ts`.

## 13. Human approval requirements
None for the audit itself. Any resulting remediation goes through the human-approval-gated Audit Remediation workflow, whose real scope is limited to `robots.txt`, `sitemap.xml`, and `index.html` canonical changes (verified via `github.ts`'s `REMEDIATION_OPERATIONS` map).

## 14. Security restrictions
Real outbound HTTP requests to the target site; rate-limited on the standalone API route (confirmed: 15 requests/hour/user for `/api/seo-audit`).

## 15. Anti-hallucination requirements
A crawl failure is surfaced honestly rather than papered over; findings are grounded only in real crawl/API data, never invented.

## 16. Failure behavior
Confirmed for `/api/seo-audit`: 422 for a crawl failure (the underlying message is shown verbatim to the user), 502 for an unexpected internal error (logged server-side, generic message shown to the user). Whether the chat-dispatch path surfaces the identical distinction is NOT VERIFIED IN CURRENT CODEBASE.

## 17. Current implementation status
Real (dispatched) — the single most reused real pipeline among the 27 agents.

## 18. Exact specification file path
`Agents/website-audit-agent.md`

## 19. Exact implementation path
`src/agents/website-audit-agent/` (root spec/scaffold); `web/src/server/backend/website-audit.ts` (real shared execution); `web/src/server/backend/remediation.ts` (DIAGNOSE-step reuse); `web/src/server/backend/reporting.ts` (real `WebsiteAuditAgent` class)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `WEBSITE_AUDIT_AGENT_ID` (shared with `TECHNICAL_SEO_AGENT_ID`) branch, calling `runFullAudit()`; also `web/src/app/api/seo-audit/route.ts` (`POST`, confirmed to call the identical function); `src/workflows/seo-audit-workflow.ts` step 2.

## 21. Related workflow(s)
`technical/workflows/SEO_AUDIT_WORKFLOW.md`, `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`

## 22. How an admin changes its behavior
Edit `web/src/server/backend/website-audit.ts` to change audit logic or scoring; edit `web/src/app/api/seo-audit/route.ts` to change the standalone API route's rate limit (currently 15/hour/user) or persistence behavior.

## 23. How a client interacts with it
A client can request an audit via chat or the dedicated audit form/page and receive a real, scored report; a failed crawl is reported honestly rather than concealed.

## 24. Known limitations
Depends on the target site being reachable and crawlable; performance depth is only as complete as the underlying Google PageSpeed/Lighthouse API response.

## 25. Verification status
VERIFIED real, by direct code read of `website-audit.ts`, `/api/seo-audit/route.ts`, `remediation.ts`, and `reporting.ts`.
