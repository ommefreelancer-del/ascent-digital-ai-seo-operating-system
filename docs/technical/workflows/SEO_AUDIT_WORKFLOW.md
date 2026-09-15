# Workflow: SEO Audit

Classification: **AUTOMATIC** (diagnostic, read-only — no approval gate, since nothing is changed).

## Purpose

Evaluate a website's technical/SEO health and return a prioritized, evidence-based report.

## Entry points (both confirmed to call the same real function)

1. **Chat dispatch:** Boss Agent assigns `website-audit-agent` or `technical-seo-agent` → `messages/route.ts` line ~706 routes both IDs to the same real pipeline.
2. **Dedicated UI route:** `web/src/app/api/seo-audit/route.ts` `POST` handler — confirmed by direct code read to call `runFullAudit(url, targetKeyword)` from `web/src/server/backend/website-audit.ts`, the identical function chat dispatch uses. Applies its own rate limit: 15 audits/hour/user.

A separate root-layer 23-step workflow (`src/workflows/seo-audit-workflow.ts`) also exists; step 6 gates full Lighthouse/Core Web Vitals auditing behind an explicit `includePerformanceAudit: true` opt-in. **NOT VERIFIED IN CURRENT CODEBASE** whether the web-layer `runFullAudit()` applies the same opt-in gate, or always runs the full Lighthouse pass — confirm directly in `website-audit.ts` before telling a client every audit includes full Core Web Vitals data.

## Trigger

A user message containing a URL, routed to Website Audit Agent or Technical SEO Agent; or a direct call to `/api/seo-audit`.

## Required inputs

A website URL. Optional: a target keyword, a `projectId` to associate the audit with.

## Step sequence

1. Rate-limit check (15/hour/user, UI route only — confirm chat-dispatch path's own limit separately).
2. Real crawl: robots.txt, sitemap.xml, every discovered internal page.
3. Real Lighthouse pass (via `chrome-launcher`).
4. HTTP header inspection, metadata/canonical analysis, structured-data validation (type-specific required properties: Organization, Person, WebSite, WebPage, BreadcrumbList, FAQPage, Article, LocalBusiness).
5. Internal/broken-link analysis, accessibility checks, Core Web Vitals.
6. Result persisted; findings separated from recommendations.

## Agent involved

Website Audit Agent / Technical SEO Agent (same real pipeline for both IDs).

## Data passed between steps

In-process function calls within `website-audit.ts`; no inter-agent handoff during the audit itself.

## Approval gates

None — read-only diagnosis.

## Integrations used

Google PageSpeed Insights / Chrome UX Report API (`GOOGLE_PAGESPEED_API_KEY`), local headless Chrome (Lighthouse via `chrome-launcher`).

## Outputs

Website Audit Report, Technical Issue List, SEO Health Score, Priority Recommendations.

## Persistence / storage

`SeoAudit` Prisma model (`resultJson`, `criticalCount`/`warningCount`/`infoCount`). If `projectId` supplied: a `ProjectActivity` row. Always: an `ActivityEvent` (`category: "seo-audit"`).

## Error handling

Errors distinguish a crawlable-but-failed case (HTTP 422, message shown verbatim — "could not be crawled") from an unexpected failure (HTTP 502, logged server-side, generic message to the client).

## Logging / audit behavior

Real audit runs log through the codebase-wide `AuditLogger`/`var/` convention; `logActivity()` records the `ActivityEvent`.

## Completion criteria

`runFullAudit()` returns successfully and the `SeoAudit` row is created.

## What happens when a step is unavailable

A check that cannot run (e.g. a blocked internal request, an unreachable page) is reported as skipped/failed for that specific check — never fabricated.

## Downstream routing

Findings route (per agent specs) to Technical SEO Agent, On-Page SEO Agent, SEO Strategy Agent. Real downstream *action* on findings only happens via the separate Technical Remediation workflow (human-approval gated). Follow-up continuity: `follow-up-routing.ts` routes "now fix the issues" toward remediation, with a carve-out preventing Website Audit Agent (diagnostic-only) from claiming it can fix anything itself.

## Exact implementation file(s)

`web/src/server/backend/website-audit.ts`, `web/src/app/api/seo-audit/route.ts`, `web/src/app/api/workspace/messages/route.ts` (dispatch), `src/workflows/seo-audit-workflow.ts` (root, alternate/older path).

## Exact documentation file(s)

This file; `agents/website-audit-agent.md`; `agents/technical-seo-agent.md`.
