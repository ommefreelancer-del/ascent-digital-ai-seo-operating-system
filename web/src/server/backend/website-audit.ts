import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import type { AuditFinding, OnPageSeoResult, TechnicalSeoResult, WebsiteAuditResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentsPromise: Promise<{ siteAuditOrchestrator: any; onPageAgent: any; techSeoAgent: any; crawlWebsite: any; dedupeDirectoryIndexVariants: any }> | null = null;

async function getAgents() {
  if (!agentsPromise) {
    agentsPromise = (async () => {
      const [
        { SiteAuditOrchestrator },
        { loadWebsiteAuditAgentConfig },
        { OnPageSeoAgent },
        { loadOnPageSeoAgentConfig },
        { TechnicalSeoAgent },
        { loadTechnicalSeoAgentConfig },
        { crawlWebsite },
        { dedupeDirectoryIndexVariants },
      ] = await Promise.all([
        importBackend("agents/website-audit-agent/site-audit-orchestrator.js"),
        importBackend("agents/website-audit-agent/config/website-audit-agent.config.js"),
        importBackend("agents/on-page-seo-agent/on-page-seo-agent.js"),
        importBackend("agents/on-page-seo-agent/config/on-page-seo-agent.config.js"),
        importBackend("agents/technical-seo-agent/technical-seo-agent.js"),
        importBackend("agents/technical-seo-agent/config/technical-seo-agent.config.js"),
        importBackend("core/crawling/website-crawler.js"),
        importBackend("core/crawling/dedupe-directory-index-variants.js"),
      ]);

      // SiteAuditOrchestrator supersedes the frozen single-page WebsiteAuditAgent
      // as the web app's entry point: it performs a real multi-page crawl
      // (src/core/crawling/website-crawler.js) and runs every page-level AND
      // site-level checker (broken links, redirect chains, orphan pages,
      // HTTP header security) -- see runFullAudit() below.
      const siteAuditOrchestrator = await SiteAuditOrchestrator.create(
        loadWebsiteAuditAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "website-audit-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      const onPageAgent = await OnPageSeoAgent.create(
        loadOnPageSeoAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "on-page-seo-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      const techSeoAgent = await TechnicalSeoAgent.create(
        loadTechnicalSeoAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "technical-seo-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      return { siteAuditOrchestrator, onPageAgent, techSeoAgent, crawlWebsite, dedupeDirectoryIndexVariants };
    })();
  }
  return agentsPromise;
}

let lighthousePromise: Promise<{ provider: any }> | null = null;

async function getLighthouseProvider() {
  if (!lighthousePromise) {
    lighthousePromise = (async () => {
      const { LighthousePerformanceDataProvider } = await importBackend(
        "agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js",
      );
      return { provider: new LighthousePerformanceDataProvider() };
    })();
  }
  return lighthousePromise;
}

let fetchHtmlPromise: Promise<{ fetchHtml: (url: string) => Promise<string> }> | null = null;

/**
 * Fetches a real page's HTML server-side by delegating to the canonical
 * fetch-html implementation at src/core/crawling/fetch-html.ts (compiled to
 * dist/src/core/crawling/fetch-html.js). This is thin glue code in the web
 * layer only -- the frozen WebsiteAuditAgent itself still never fetches
 * anything; it only ever receives real HTML a caller already has in hand,
 * exactly as designed. The redirect-following and SSRF re-validation on
 * every hop now live in exactly one place instead of being duplicated here.
 */
export async function fetchHtml(url: string): Promise<string> {
  if (!fetchHtmlPromise) {
    fetchHtmlPromise = import(/* webpackIgnore: true */ `file://${path.join(backendDist, "core/crawling/fetch-html.js")}`);
  }
  const { fetchHtml: canonical } = await fetchHtmlPromise;
  return canonical(url);
}

export interface CrawledPageSummary {
  readonly url: string;
  readonly status: number | null;
  readonly error: string | null;
  /** The verified, classified outcome of this page's crawl attempt (e.g. "success", "http_error", "dns_failure", "ssl_failure", "timeout", "connection_failure", "robots_blocked", "invalid_html") -- never a guess. */
  readonly outcome?: string;
  readonly contentType?: string | null;
  readonly durationMs?: number | null;
  /**
   * ON-PAGE SEO EVIDENCE FIX (2026-09-10): this page's OWN real, already-
   * computed audit findings (title/meta length, heading structure, image
   * alt text, page-level internal links, schema/structured-data validity,
   * canonical, Open Graph, Twitter Card, mobile-friendliness,
   * accessibility -- every AuditChecker in
   * src/agents/website-audit-agent/checks/ that SiteAuditOrchestrator
   * already runs against EVERY crawled page, not just the start URL).
   * Previously computed by SiteAuditOrchestrator.auditCrawl() (see each
   * PageAuditEntry.audit) and then silently discarded when this array was
   * built -- only the start URL's own findings ever survived, merged into
   * the top-level websiteAudit.findings. `undefined` for a page whose audit
   * never ran (crawl-only failure); `[]` is a real, checked-and-clean
   * result, not "not checked". See buildOnPageSeoEvidenceContext() below,
   * the only consumer of this field.
   */
  readonly findings?: readonly AuditFinding[];
}

export interface CrawlSummary {
  readonly runId: string;
  readonly startUrl: string;
  readonly pagesCrawled: number;
  readonly pages: readonly CrawledPageSummary[];
  readonly robotsTxtChecked: boolean;
  readonly robotsTxtFound: boolean;
  readonly sitemapChecked: boolean;
  readonly sitemapUrlsFound: number;
  /** SITEMAP REMEDIATION CAPABILITY (2026-08-22): the real, successfully-fetched page URLs from THIS SAME crawl -- the ONLY real source sitemap-remediation-planner.ts is allowed to draw sitemap entries from. Never includes a page that failed to fetch/was blocked. */
  readonly crawledUrls: readonly string[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface LighthouseSummary {
  readonly available: boolean;
  readonly coreWebVitals: { readonly lcpMs: number | null; readonly inpMs: number | null; readonly cls: number | null } | null;
  readonly categoryScores: { readonly performance: number | null; readonly accessibility: number | null; readonly bestPractices: number | null; readonly seo: number | null } | null;
  readonly source: string;
}

export interface FullAuditResult {
  readonly websiteAudit: WebsiteAuditResult;
  readonly onPageSeo: OnPageSeoResult;
  readonly technicalSeo: TechnicalSeoResult;
  readonly crawl: CrawlSummary;
  readonly lighthouse: LighthouseSummary;
}

/**
 * Builds a reply straight from real FullAuditResult fields -- no LLM, no
 * fabrication, every number traceable to the pipeline that produced it.
 *
 * EVIDENCE HANDOFF FIX (2026-08-18): moved here (was a private function
 * inlined in api/workspace/messages/route.ts) and exported, mirroring
 * server/backend/remediation.ts's own buildRemediationApprovalCardMeta()
 * precedent -- an inlined, private route.ts function is never independently
 * testable, and this same formatting is now needed in two places: the
 * top-level chat reply (route.ts's own audit branch, unchanged), and as the
 * real-evidence grounding block passed into the content pipeline once the
 * Phase 5 workflow continues past remediation (see buildAuditFindingsContext()
 * below) -- reusing one real function rather than duplicating its logic.
 *
 * ACCESS-EVIDENCE FIX (2026-09-11): `sourceLabel` is an optional, additive,
 * backward-compatible override for the opening sentence only -- every
 * existing caller that omits it keeps the exact original "Ran a live
 * technical SEO audit..." wording, unchanged. Exists because a caller can
 * now legitimately pass a REUSED, previously-persisted `result` instead of
 * one just produced by a fresh crawl (see route.ts's own auditUrl branch) --
 * "Ran a live... audit" would be a real, false claim in that case ("nothing
 * below is estimated" implies freshness this data does not have). Never
 * changes any other line: every finding/score/count below is still the
 * same real, already-computed data either way.
 */
export function summarizeAuditForChat(url: string, result: FullAuditResult, sourceLabel?: string): string {
  const { websiteAudit, crawl, lighthouse } = result;
  const lines: string[] = [
    sourceLabel ?? `Ran a live technical SEO audit on ${url} using ADASOS's production audit pipeline (real crawl + Lighthouse -- nothing below is estimated).`,
    "",
    `**Crawl**: ${crawl.pagesCrawled} page(s) crawled. robots.txt: ${crawl.robotsTxtFound ? "found" : "checked, not found (404)"}. sitemap.xml: ${crawl.sitemapUrlsFound} URL(s) discovered (checked).`,
    `**HTTP headers**: real response headers inspected across every crawled page (security-header findings included below if any).`,
    lighthouse.available
      ? `**Lighthouse**: Performance ${lighthouse.categoryScores?.performance ?? "—"}, Accessibility ${lighthouse.categoryScores?.accessibility ?? "—"}, Best Practices ${lighthouse.categoryScores?.bestPractices ?? "—"}, SEO ${lighthouse.categoryScores?.seo ?? "—"}. Core Web Vitals -- LCP ${lighthouse.coreWebVitals?.lcpMs != null ? `${Math.round(lighthouse.coreWebVitals.lcpMs)}ms` : "—"}, CLS ${lighthouse.coreWebVitals?.cls ?? "—"}.`
      : `**Lighthouse**: Not Verifiable (the real Lighthouse run did not return a result for this URL).`,
    `**Findings**: ${websiteAudit.summary.criticalCount} critical, ${websiteAudit.summary.warningCount} warning, ${websiteAudit.summary.infoCount} info.`,
  ];

  const notable = websiteAudit.findings.filter((f) => f.severity !== "info").slice(0, 6);
  if (notable.length > 0) {
    lines.push("", "Top issues:");
    for (const f of notable) {
      lines.push(`- [${f.severity}] (${f.category}) ${f.message}`);
    }
  }

  lines.push("", "Full evidence (every crawled page, all findings, real headers) is saved -- open SEO Audit for the complete report, or ask me about any specific finding.");
  return lines.join("\n");
}

/**
 * EVIDENCE HANDOFF FIX (2026-08-18): the real, non-fabricated grounding
 * block the Phase 5 orchestrated workflow's continuation into Strategy/
 * Keyword Research/Content/On-Page SEO appends to its own userMessage --
 * mirrors this codebase's established build*Context() convention
 * (buildSearchConsoleContext, buildGovernanceEvidenceContext,
 * buildCampaignTrackingContext, buildGoogleSheetsContext): a bracketed,
 * explicitly-labeled real-evidence block with an instruction never to
 * invent beyond it. Reuses summarizeAuditForChat()'s own real, deterministic
 * text -- the exact same findings already shown to the user for the audit
 * stage -- rather than re-deriving or duplicating that formatting.
 */
export function buildAuditFindingsContext(url: string, result: FullAuditResult): string {
  return (
    `[REAL, VERIFIED WEBSITE AUDIT EVIDENCE for ${url} -- produced by ADASOS's real audit pipeline earlier in this ` +
    `workflow. Use this directly for keyword research, strategy, content, and on-page recommendations; never invent ` +
    `additional findings beyond what's listed here:\n${summarizeAuditForChat(url, result)}]`
  );
}

/**
 * ON-PAGE SEO EVIDENCE FIX (2026-09-10): a real, live-observed gap --
 * buildAuditFindingsContext() above deliberately summarizes for a chat
 * reply (top 6 non-"info" site-wide issues only, per summarizeAuditForChat()),
 * which is the wrong shape for a genuine on-page SEO audit: page-level
 * checks like MetadataChecker/HeadingStructureChecker only ever emit a
 * finding when something is WRONG (a compliant title/meta/heading
 * structure produces zero findings for that category, by design -- see
 * each checker's own header), so "info-only, capped at 6, site-wide" would
 * silently omit most or all of the real per-page evidence an On-Page SEO
 * Agent needs (title/meta, H1-H6, image alt, page-level internal links,
 * schema/structured-data, canonical, Open Graph, Twitter Card,
 * mobile-friendliness, accessibility).
 *
 * This surfaces EVERY real finding (all severities -- never just
 * warning/critical) for ONE specific page, grouped by the exact category
 * strings the real checkers in src/agents/website-audit-agent/checks/
 * already use.
 *
 * FOUR-STATE EVIDENCE FIX (2026-09-10): "no findings recorded" used to be
 * reported identically whether a category's checker ran and found nothing
 * wrong, or the page was never checked at all -- a real ambiguity the
 * previous version explicitly refused to resolve ("does NOT necessarily
 * mean..."). This is now resolved with real, structural grounding, not a
 * guess: SiteAuditOrchestrator.auditCrawl() (see its own source) runs
 * EVERY page-level checker together, in one atomic per-page audit call --
 * a page's `audit` is either a complete WebsiteAuditResult (every checker
 * ran) or `null` (the audit never completed for that page at all; see
 * PageAuditEntry.audit). So CrawledPageSummary.findings being `undefined`
 * means the audit never ran for that page (state: NOT CHECKED, checked at
 * the whole-page level below); being defined but empty for one category
 * means that category's checker DID run as part of the same atomic audit
 * and found nothing to flag (state: VERIFIED -- NO ISSUE FOUND); one or
 * more real findings is the fourth state (state: FINDING). The true fifth
 * state -- a data point ADASOS has no checker for at all -- is UNAVAILABLE,
 * reserved for keyword/content placement below (never a per-category
 * state, since every listed category DOES have a real checker).
 *
 * KEYWORD/CONTENT PLACEMENT (2026-09-10): confirmed, at the source, that no
 * existing ADASOS capability verifies actual keyword placement in a page's
 * real content -- src/agents/on-page-seo-agent/recommendations/
 * keyword-usage-recommender.ts's own header already documents this
 * explicitly ("This agent does not have the page's actual body text... it
 * recommends where it *should* go rather than claiming to confirm where it
 * currently is or isn't"), and no AuditChecker in checks/ computes it
 * either. SavedKeyword (prisma schema) is unrelated -- workspace-level
 * keyword research with no URL/page association, not page-content
 * placement data; attaching it here would misrepresent an unrelated
 * dataset as page-specific evidence, which is exactly the fabrication this
 * fix must not do. `keywordEvidence` is the smallest production-safe
 * integration point for this: an optional, explicitly-labeled parameter a
 * FUTURE real, page-scoped, persisted keyword/content-placement capability
 * can supply real evidence through, once one exists -- no caller passes it
 * today (confirmed: zero call sites), so the honest "UNAVAILABLE" message
 * is what every current caller actually sees.
 *
 * Falls back to `result.websiteAudit` (the already-known-good start-page
 * audit, always present) when `url` doesn't match a specific crawled page
 * entry -- e.g. a bare/normalized URL, or a page whose own crawl attempt
 * never completed -- always labeled with which page's evidence is
 * actually being shown, never silently substituted.
 */
const ON_PAGE_EVIDENCE_CATEGORIES: readonly { readonly category: string; readonly label: string }[] = [
  { category: "metadata", label: "Title tag / meta description" },
  { category: "headings", label: "H1-H6 heading structure" },
  { category: "image-alt", label: "Image ALT text" },
  { category: "internal-links", label: "Page-level internal linking" },
  { category: "schema-type-validation", label: "Schema.org type validity" },
  { category: "structured-data-validation", label: "Structured data (JSON-LD) validity" },
  { category: "canonical", label: "Canonical tag" },
  { category: "open-graph", label: "Open Graph tags" },
  { category: "twitter-card", label: "Twitter Card tags" },
  { category: "mobile-friendliness", label: "Mobile-friendliness (viewport)" },
  { category: "accessibility", label: "Accessibility" },
];

/**
 * `keywordEvidence`: the smallest production-safe integration point for a
 * FUTURE real, page-scoped keyword/content-placement capability -- see this
 * function's own header. `undefined`/`null`/empty (every current caller)
 * means no such capability has supplied real evidence yet, so the
 * UNAVAILABLE line is shown; a non-empty string is included verbatim,
 * clearly labeled, never merged into or mistaken for a checker finding.
 */
export function buildOnPageSeoEvidenceContext(url: string, result: FullAuditResult, keywordEvidence?: string | null): string {
  const matchedPage = result.crawl.pages.find((p) => p.url === url);
  const findings = matchedPage?.findings ?? (result.websiteAudit.url === url || (!matchedPage && result.crawl.startUrl === url) ? result.websiteAudit.findings : undefined);
  const evidencePageUrl = matchedPage ? matchedPage.url : result.websiteAudit.url ?? result.crawl.startUrl;

  if (findings === undefined) {
    return (
      `[ON-PAGE SEO EVIDENCE for ${url}]\n` +
      `STATE: NOT CHECKED -- no saved per-page audit evidence was found for this exact URL in this workspace's ` +
      `most recent audit of ${result.crawl.startUrl} (crawled pages: ${result.crawl.pages.map((p) => p.url).join(", ") || "none"}). ` +
      `Do not invent title, meta description, heading, alt-text, internal-link, or schema findings for this page -- ` +
      `report that no saved on-page evidence exists for it and recommend running a fresh audit.]`
    );
  }

  const lines: string[] = [
    `[ON-PAGE SEO EVIDENCE for ${evidencePageUrl}${evidencePageUrl !== url ? ` (closest available saved page-level audit -- no exact saved entry for ${url})` : ""} -- ` +
      "produced by ADASOS's real audit pipeline. Each category below is labeled with its real state -- FINDING (a " +
      "real, specific issue/observation), VERIFIED / NO ISSUE FOUND (the checker ran and found nothing to flag -- " +
      "this IS a confirmed pass, not an absence of data), or UNAVAILABLE (no ADASOS capability computes this at " +
      "all). Never invent a title, meta description, heading, alt text, internal link, or schema fact beyond what " +
      "is listed here, and never present UNAVAILABLE or NOT CHECKED as if it were a confirmed pass.]",
  ];

  for (const { category, label } of ON_PAGE_EVIDENCE_CATEGORIES) {
    const categoryFindings = findings.filter((f) => f.category === category);
    lines.push("", `${label} (category: ${category}):`);
    if (categoryFindings.length === 0) {
      lines.push("  STATE: VERIFIED / NO ISSUE FOUND -- this category's checker ran as part of this page's real audit and recorded no finding.");
    } else {
      for (const f of categoryFindings) {
        lines.push(`  STATE: FINDING -- [${f.severity}] ${f.message} (Recommendation: ${f.recommendation})`);
      }
    }
  }

  lines.push(
    "",
    "Keyword/content placement analysis:",
    keywordEvidence && keywordEvidence.trim() !== ""
      ? `  STATE: FINDING -- ${keywordEvidence.trim()}`
      : "  STATE: UNAVAILABLE -- no existing ADASOS capability verifies actual keyword placement in this page's real content; do not fabricate it.",
  );

  return lines.join("\n");
}

// CRAWL BUDGET FIX (2026-09-10): 15 was an arbitrary, undocumented override
// of the crawler's own built-in default (website-crawler.ts's
// DEFAULT_MAX_PAGES = 50) -- real evidence it was too small: a genuinely
// small ~14-page portfolio site with a modest 6-post blog and a real,
// correctly-discovered sitemap.xml (18 URLs total: the site's other pages,
// discovered via links, are already ~12 of that budget) needs more than 15
// pages to actually reach the sitemap-seeded, otherwise-unlinked articles
// queued near the end of a real sitemap's URL list -- the crawler's own
// FIFO/BFS order means a too-small budget silently truncates exactly the
// pages sitemap discovery exists to find. Aligning with the crawler's own
// already-established default removes an arbitrary, demonstrably
// insufficient number rather than inventing a new one.
const MAX_CRAWL_PAGES = 50;

export interface RawCrawledPage {
  readonly url: string;
  readonly finalUrl: string | null;
  readonly status: number | null;
  readonly error: string | null;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly contentType?: string | null;
  readonly outcome?: string;
  readonly durationMs?: number | null;
  readonly redirectChain?: readonly string[];
  /** The real, fetched HTML body, or `null` if this page was never successfully fetched. Used only to detect a directory/index.html URL pair that serves byte-identical content -- see dedupeDirectoryIndexVariants(). */
  readonly html?: string | null;
}

/**
 * Builds a real, verified, multi-line diagnostic report from the actual
 * crawl evidence -- never a generic "possible causes" message. Every line
 * corresponds to a field the crawler genuinely measured (HTTP status,
 * content-type, redirect chain, classified failure category, fetch
 * duration); nothing here is guessed. Anti-hallucination requirement: if a
 * fact wasn't captured, it's simply omitted, never invented.
 */
export function buildCrawlFailureDiagnostic(requestedUrl: string, crawlResult: { robotsTxtContent: string | null; sitemapUrls: readonly string[]; limitations: readonly string[] }, page: RawCrawledPage | null, crawlDurationMs: number): string {
  const lines: string[] = [`Website Audit could not analyze ${requestedUrl}. Verified diagnostics from the real crawl:`, ""];

  if (!page) {
    lines.push("- No page was ever fetched -- the crawl produced zero results before any request could complete.");
  } else {
    lines.push(`- Requested URL: ${page.url}`);
    if (page.finalUrl && page.finalUrl !== page.url) lines.push(`- Final URL after redirects: ${page.finalUrl}`);
    if (page.redirectChain && page.redirectChain.length > 1) lines.push(`- Redirect chain: ${page.redirectChain.join(" -> ")}`);
    if (page.status !== null && page.status !== undefined) lines.push(`- HTTP status: ${page.status}`);
    if (page.contentType) lines.push(`- Content-Type: ${page.contentType}`);
    if (page.outcome) lines.push(`- Verified outcome: ${page.outcome}`);
    if (page.durationMs !== null && page.durationMs !== undefined) lines.push(`- Fetch duration: ${page.durationMs}ms`);
    lines.push(`- Exact reason: ${page.error ?? "The page was fetched successfully but WebsiteAuditAgent rejected the content -- see limitations below."}`);
  }

  lines.push(
    "",
    `- robots.txt: ${crawlResult.robotsTxtContent !== null ? "found and checked" : "not found or could not be fetched"}`,
    `- sitemap.xml: ${crawlResult.sitemapUrls.length} URL(s) discovered`,
    `- Total crawl duration: ${crawlDurationMs}ms`,
  );
  if (crawlResult.limitations.length > 0) {
    lines.push("", "Crawl limitations:");
    for (const l of crawlResult.limitations) lines.push(`  - ${l}`);
  }
  return lines.join("\n");
}

/** Structured diagnostic log for every Website Audit request -- request URL, final URL, HTTP status, response headers, content-type, crawl duration, crawl result, and exact failure reason (if any). Real, measured values only. */
function logAuditDiagnostics(requestedUrl: string, crawlResult: { pages: readonly RawCrawledPage[]; robotsTxtContent: string | null; sitemapUrls: readonly string[] }, homePage: RawCrawledPage | null, crawlDurationMs: number, succeeded: boolean): void {
  console.log(
    `[website-audit] ${JSON.stringify({
      requestUrl: requestedUrl,
      finalUrl: homePage?.finalUrl ?? null,
      httpStatus: homePage?.status ?? null,
      responseHeaders: homePage?.headers ?? null,
      contentType: homePage?.contentType ?? null,
      crawlDurationMs,
      pagesDiscovered: crawlResult.pages.length,
      crawlResult: succeeded ? "success" : "failed",
      outcome: homePage?.outcome ?? null,
      failureReason: succeeded ? null : (homePage?.error ?? "no page could be fetched"),
      robotsTxtFound: crawlResult.robotsTxtContent !== null,
      sitemapUrlsFound: crawlResult.sitemapUrls.length,
    })}`,
  );
}

/**
 * Runs the full, real Website Audit through SiteAuditOrchestrator: a real
 * multi-page crawl (robots.txt, sitemap.xml, every discovered internal
 * page), every page-level checker, and every site-level checker (broken
 * links, redirect chains, orphan pages, HTTP header security). Supersedes
 * the old single-page-only flow (frozen WebsiteAuditAgent fed one
 * pre-fetched page) that this route used before -- see
 * web/src/app/api/seo-audit/route.ts.
 */
export async function runFullAudit(url: string, targetKeyword: string): Promise<FullAuditResult> {
  const { siteAuditOrchestrator, onPageAgent, techSeoAgent, crawlWebsite, dedupeDirectoryIndexVariants } = await getAgents();

  // Crawl once, directly, so the real robots.txt/sitemap.xml evidence
  // (WebsiteCrawlResult.robotsTxtContent / .sitemapUrls) is available for
  // the crawl summary below -- auditSite() would otherwise crawl
  // internally without exposing that raw evidence to this caller.
  const crawlStartedAt = Date.now();
  const crawlResult = await crawlWebsite(url, { maxPages: MAX_CRAWL_PAGES });
  const crawlDurationMs = Date.now() - crawlStartedAt;
  const siteResult = await siteAuditOrchestrator.auditCrawl(crawlResult);

  const rawHomePage: RawCrawledPage | null = (crawlResult.pages as RawCrawledPage[]).find((p) => p.url === crawlResult.startUrl) ?? crawlResult.pages[0] ?? null;

  const homeEntry =
    siteResult.pageAudits.find((p: { url: string; audit: unknown }) => p.url === siteResult.startUrl && p.audit) ??
    siteResult.pageAudits.find((p: { audit: unknown }) => p.audit);
  if (!homeEntry?.audit) {
    logAuditDiagnostics(url, crawlResult, rawHomePage, crawlDurationMs, false);
    throw new Error(buildCrawlFailureDiagnostic(url, crawlResult, rawHomePage, crawlDurationMs));
  }
  logAuditDiagnostics(url, crawlResult, rawHomePage, crawlDurationMs, true);
  const homePageAudit: WebsiteAuditResult = homeEntry.audit;

  // The primary "websiteAudit" block shown in the UI combines the audited
  // start page's real structural findings with every real site-level
  // finding (broken links, redirects, orphan pages, header security) --
  // proof that the multi-page crawl actually ran, not just a single fetch.
  const websiteAudit: WebsiteAuditResult = {
    requestId: siteResult.requestId,
    url: siteResult.startUrl,
    findings: [...homePageAudit.findings, ...siteResult.siteFindings],
    summary: {
      criticalCount: homePageAudit.summary.criticalCount + siteResult.siteFindings.filter((f: { severity: string }) => f.severity === "critical").length,
      warningCount: homePageAudit.summary.warningCount + siteResult.siteFindings.filter((f: { severity: string }) => f.severity === "warning").length,
      infoCount: homePageAudit.summary.infoCount + siteResult.siteFindings.filter((f: { severity: string }) => f.severity === "info").length,
    },
    limitations: Array.from(new Set([...homePageAudit.limitations, ...siteResult.limitations])),
    decidedAt: siteResult.decidedAt,
  };

  let onPageSeo: OnPageSeoResult;
  try {
    onPageSeo = await onPageAgent.generateRecommendations({
      id: randomUUID(),
      websiteAudit: homePageAudit,
      keywordResearch: { requestId: randomUUID(), classifiedKeywords: [{ keyword: targetKeyword, intent: "informational", intentRationale: "Caller-supplied target keyword.", metrics: null }], topicClusters: [], metricsAvailable: false, limitations: [], rankingDisclaimer: "", decidedAt: new Date().toISOString() },
      targetKeyword,
    });
  } catch {
    onPageSeo = { requestId: randomUUID(), url, targetKeyword, recommendations: [], crossFunctionalNotes: [], limitations: ["Could not match the supplied target keyword against a classified keyword list."], decidedAt: new Date().toISOString() };
  }

  const technicalSeo: TechnicalSeoResult = await techSeoAgent.generateRecommendations({
    id: randomUUID(),
    websiteAudit: homePageAudit,
    crossFunctionalNotes: onPageSeo.crossFunctionalNotes,
  });

  const rawPagesByUrl = new Map((crawlResult.pages as RawCrawledPage[]).map((p) => [p.url, p]));
  const crawl: CrawlSummary = {
    runId: siteResult.requestId,
    startUrl: siteResult.startUrl,
    pagesCrawled: siteResult.pagesCrawled,
    // ON-PAGE SEO EVIDENCE FIX (2026-09-10): `p.audit` (PageAuditEntry's own
    // real, already-computed WebsiteAuditResult for THIS page -- title/meta,
    // headings, image alt, page-level internal links, schema, canonical,
    // Open Graph, Twitter Card, mobile-friendliness, accessibility) used to
    // be dropped here -- the type annotation below explicitly narrowed `p`
    // to {url, status, error}, discarding the sibling `audit` field
    // SiteAuditOrchestrator.auditCrawl() already populates for every
    // crawled page, not just the start URL. Retaining it (as
    // p.audit?.findings) is the ONLY change: no new checker, no new crawl,
    // no new computation -- this data was always real and already
    // computed, just never persisted past this one line.
    pages: siteResult.pageAudits.map((p: { url: string; status: number | null; error: string | null; audit: { findings: readonly AuditFinding[] } | null }) => {
      const raw = rawPagesByUrl.get(p.url);
      return { url: p.url, status: p.status, error: p.error, outcome: raw?.outcome, contentType: raw?.contentType, durationMs: raw?.durationMs, findings: p.audit?.findings };
    }),
    // robots.txt and sitemap.xml are always attempted by crawlWebsite() --
    // "found" reflects whether the real request actually returned content,
    // never an assumption.
    robotsTxtChecked: true,
    robotsTxtFound: crawlResult.robotsTxtContent !== null,
    sitemapChecked: true,
    sitemapUrlsFound: crawlResult.sitemapUrls.length,
    // SITEMAP REMEDIATION CAPABILITY (2026-08-22): only genuinely,
    // successfully-fetched pages (outcome === "success") -- never a page
    // that was blocked, errored, or never reached.
    //
    // DUPLICATE-VARIANT FIX (2026-09-10): a real crawl commonly discovers
    // BOTH "https://site/about/" and "https://site/about/index.html" as two
    // separate, genuinely successful fetches (a directory URL resolves to
    // its own index.html by web-server convention) -- listing both in a
    // generated sitemap would propose two URLs for what is actually one
    // page. dedupeDirectoryIndexVariants() drops the index.html entry only
    // when its directory sibling was ALSO crawled with byte-identical HTML
    // (real, observed content -- never guessed from the URL shape alone),
    // keeping the directory-style URL. See
    // src/core/crawling/dedupe-directory-index-variants.ts's own header.
    crawledUrls: dedupeDirectoryIndexVariants(
      (crawlResult.pages as RawCrawledPage[])
        .filter((p) => p.outcome === "success")
        .map((p) => ({ url: p.finalUrl ?? p.url, html: p.html ?? null })),
    ),
    limitations: siteResult.limitations,
    decidedAt: siteResult.decidedAt,
  };

  let lighthouse: LighthouseSummary;
  try {
    const { provider } = await getLighthouseProvider();
    const perf = await provider.fetchPerformanceData({ url, keywords: [] });
    lighthouse = perf
      ? { available: true, coreWebVitals: perf.coreWebVitals, categoryScores: perf.categoryScores, source: perf.source }
      : { available: false, coreWebVitals: null, categoryScores: null, source: "lighthouse" };
  } catch {
    lighthouse = { available: false, coreWebVitals: null, categoryScores: null, source: "lighthouse" };
  }

  return { websiteAudit, onPageSeo, technicalSeo, crawl, lighthouse };
}
