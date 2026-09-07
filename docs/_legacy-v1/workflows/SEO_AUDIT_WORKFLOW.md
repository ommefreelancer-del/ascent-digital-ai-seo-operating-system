# SEO Audit Workflow

Audience: admin / developer.

## Two audit entry points (see also Documentation Conflicts #5)

1. **Chat dispatch (confirmed real):** Boss Agent assigns `website-audit-agent` or `technical-seo-agent` → `messages/route.ts` line ~706 routes both IDs to the same real pipeline in `web/src/server/backend/website-audit.ts`. Given only a URL, the pipeline runs automatically: crawl, Lighthouse (via `chrome-launcher`), robots.txt, sitemap.xml, HTTP headers, metadata/canonicals, structured data (with type-specific required-property validation for Organization, Person, WebSite, WebPage, BreadcrumbList, FAQPage, Article, LocalBusiness), internal/broken-link analysis, accessibility, Core Web Vitals.
2. **Root 23-step workflow** (`src/workflows/seo-audit-workflow.ts`) — a more granular, numbered workflow at the root-backend layer, step 2 of which is "Technical SEO Audit" via `SiteAuditOrchestrator.auditCrawl()` + `TechnicalSeoAgent.generateRecommendations()`. Step 6 gates full Lighthouse/Core Web Vitals auditing behind an explicit `includePerformanceAudit: true` opt-in, since headless Chrome auditing is comparatively expensive.

**NOT VERIFIED IN CURRENT CODEBASE:** whether the chat-dispatch path (`website-audit.ts`) applies the same performance-audit opt-in gate as the root workflow, or always runs the full Lighthouse pass. Confirm directly before telling a client every chat-triggered audit includes full Core Web Vitals data.

Also **NOT VERIFIED:** whether `web/src/app/api/seo-audit/route.ts` (a separate, dedicated UI route) calls into `website-audit.ts` or the root 23-step workflow — see `docs/architecture/DOCUMENTATION_CONFLICTS.md` conflict 5.

## Outputs

Website Audit Report, Technical Issue List, SEO Health Score, Priority Recommendations — persisted via the `SeoAudit` Prisma model. Findings are explicitly separated from recommendations; a check that cannot run is reported as skipped, never fabricated.

## Downstream routing

Findings route to Technical SEO Agent, On-Page SEO Agent, and SEO Strategy Agent (per spec); real downstream action on findings happens only through the separate Technical Remediation pipeline (see `docs/workflows/AUDIT_REMEDIATION_WORKFLOW.md`), which has its own human-approval gate.

## Follow-up continuity

`follow-up-routing.ts` heuristically routes a follow-up like "Now fix the issues you found" toward the remediation continuity, with an explicit carve-out preventing Website Audit Agent (diagnostic-only) from being misrouted into believing it can fix anything itself.

## Where to modify

- Real crawler/audit logic: `web/src/server/backend/website-audit.ts`.
- Root 23-step workflow: `src/workflows/seo-audit-workflow.ts`.
- Database model: `SeoAudit` in `web/prisma/schema.prisma`.
- Chat dispatch: `web/src/app/api/workspace/messages/route.ts` (`WEBSITE_AUDIT_AGENT_ID`, `TECHNICAL_SEO_AGENT_ID`).
