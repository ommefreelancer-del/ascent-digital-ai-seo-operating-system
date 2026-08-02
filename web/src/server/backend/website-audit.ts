import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import type { OnPageSeoResult, TechnicalSeoResult, WebsiteAuditResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentsPromise: Promise<{ siteAuditOrchestrator: any; onPageAgent: any; techSeoAgent: any; crawlWebsite: any }> | null = null;

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
      ] = await Promise.all([
        importBackend("agents/website-audit-agent/site-audit-orchestrator.js"),
        importBackend("agents/website-audit-agent/config/website-audit-agent.config.js"),
        importBackend("agents/on-page-seo-agent/on-page-seo-agent.js"),
        importBackend("agents/on-page-seo-agent/config/on-page-seo-agent.config.js"),
        importBackend("agents/technical-seo-agent/technical-seo-agent.js"),
        importBackend("agents/technical-seo-agent/config/technical-seo-agent.config.js"),
        importBackend("core/crawling/website-crawler.js"),
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
      return { siteAuditOrchestrator, onPageAgent, techSeoAgent, crawlWebsite };
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

const MAX_CRAWL_PAGES = 15;

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
  const { siteAuditOrchestrator, onPageAgent, techSeoAgent, crawlWebsite } = await getAgents();

  // Crawl once, directly, so the real robots.txt/sitemap.xml evidence
  // (WebsiteCrawlResult.robotsTxtContent / .sitemapUrls) is available for
  // the crawl summary below -- auditSite() would otherwise crawl
  // internally without exposing that raw evidence to this caller.
  const crawlResult = await crawlWebsite(url, { maxPages: MAX_CRAWL_PAGES });
  const siteResult = await siteAuditOrchestrator.auditCrawl(crawlResult);

  const homeEntry =
    siteResult.pageAudits.find((p: { url: string; audit: unknown }) => p.url === siteResult.startUrl && p.audit) ??
    siteResult.pageAudits.find((p: { audit: unknown }) => p.audit);
  if (!homeEntry?.audit) {
    throw new Error("The start page could not be crawled or audited -- see crawl limitations for the real cause (fetch failure, robots.txt block, or non-HTML response).");
  }
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

  const crawl: CrawlSummary = {
    runId: siteResult.requestId,
    startUrl: siteResult.startUrl,
    pagesCrawled: siteResult.pagesCrawled,
    pages: siteResult.pageAudits.map((p: { url: string; status: number | null; error: string | null }) => ({ url: p.url, status: p.status, error: p.error })),
    // robots.txt and sitemap.xml are always attempted by crawlWebsite() --
    // "found" reflects whether the real request actually returned content,
    // never an assumption.
    robotsTxtChecked: true,
    robotsTxtFound: crawlResult.robotsTxtContent !== null,
    sitemapChecked: true,
    sitemapUrlsFound: crawlResult.sitemapUrls.length,
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
