// Orchestrates a full, multi-page website audit: crawls the site
// (WebsiteCrawler), runs WebsiteAuditAgent.auditWebsite() once per
// successfully-crawled page -- reusing every existing and new page-level
// checker completely unmodified, preserving WebsiteAuditAgent's own
// documented contract -- then runs the new site-level checkers
// (BrokenLinkChecker, RedirectChainChecker, SiteWideInternalLinkingChecker)
// against the crawl as a whole, since those need multi-page context a
// single-page audit cannot see. Compiles one SiteAuditResult with explicit
// per-page and site-wide limitations, following the same
// never-hide-a-limitation discipline as every other agent in this codebase.
//
// This is what Phase 3's 23-step workflow (steps 1-9) and the Phase 6 live
// test against the portfolio site both call.

import { randomUUID } from "node:crypto";
import { crawlWebsite, type WebsiteCrawlerOptions, type WebsiteCrawlResult } from "../../core/crawling/website-crawler.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { WebsiteAuditAgent } from "./website-audit-agent.js";
import type { WebsiteAuditAgentConfig } from "./config/website-audit-agent.config.js";
import type { AuditFinding, WebsiteAuditResult } from "./types/website-audit-request.types.js";
import type { SiteAuditChecker } from "./checks/site-audit-checker.js";
import { BrokenLinkChecker } from "./checks/broken-link-checker.js";
import { RedirectChainChecker } from "./checks/redirect-chain-checker.js";
import { SiteWideInternalLinkingChecker } from "./checks/site-wide-internal-linking-checker.js";
import { HeaderSecurityChecker } from "./checks/header-security-checker.js";

export interface PageAuditEntry {
  readonly url: string;
  readonly status: number | null;
  /** Real crawl error (fetch failure, robots.txt block) or audit error, or `null` if the page was audited successfully. */
  readonly error: string | null;
  readonly audit: WebsiteAuditResult | null;
}

export interface SiteAuditResult {
  readonly requestId: string;
  readonly startUrl: string;
  readonly pagesCrawled: number;
  readonly pageAudits: readonly PageAuditEntry[];
  readonly siteFindings: readonly AuditFinding[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

function defaultSiteCheckers(): SiteAuditChecker[] {
  return [new BrokenLinkChecker(), new RedirectChainChecker(), new SiteWideInternalLinkingChecker(), new HeaderSecurityChecker()];
}

export class SiteAuditOrchestrator {
  constructor(
    private readonly websiteAuditAgent: WebsiteAuditAgent,
    private readonly siteCheckers: readonly SiteAuditChecker[],
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: WebsiteAuditAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<SiteAuditOrchestrator> {
    const websiteAuditAgent = await WebsiteAuditAgent.create(config, approvalChannel);
    return new SiteAuditOrchestrator(websiteAuditAgent, defaultSiteCheckers(), new AuditLogger(config.auditLogPath));
  }

  async auditSite(startUrl: string, options: WebsiteCrawlerOptions = {}): Promise<SiteAuditResult> {
    await this.auditLogger.logEvent({
      actor: "site-audit-orchestrator",
      eventType: "site_audit_requested",
      details: { startUrl },
    });
    const crawl = await crawlWebsite(startUrl, options);
    return this.auditCrawl(crawl);
  }

  /**
   * Same as `auditSite`, but against an already-crawled `WebsiteCrawlResult`
   * -- for callers (e.g. seo-audit-workflow.ts) that need the raw crawl for
   * other steps too and must not pay for a second crawl of the same site.
   */
  async auditCrawl(crawl: WebsiteCrawlResult): Promise<SiteAuditResult> {
    const requestId = randomUUID();
    const startUrl = crawl.startUrl;

    const pageAudits: PageAuditEntry[] = [];
    for (const page of crawl.pages) {
      if (!page.html) {
        pageAudits.push({ url: page.url, status: page.status, error: page.error, audit: null });
        continue;
      }
      try {
        const audit = await this.websiteAuditAgent.auditWebsite({
          id: randomUUID(),
          html: page.html,
          url: page.finalUrl ?? page.url,
          ...(crawl.robotsTxtContent !== null ? { robotsTxtContent: crawl.robotsTxtContent } : {}),
        });
        pageAudits.push({ url: page.url, status: page.status, error: null, audit });
      } catch (error) {
        pageAudits.push({
          url: page.url,
          status: page.status,
          error: error instanceof Error ? error.message : String(error),
          audit: null,
        });
      }
    }

    const siteFindings = this.siteCheckers.flatMap((checker) => checker.check(crawl));

    const limitations: string[] = [
      ...crawl.limitations,
      "Per-page audits reuse WebsiteAuditAgent's existing structural checkers; consult each page's own result.limitations for that page's full scope.",
    ];
    const failedPages = pageAudits.filter((p) => p.audit === null).length;
    if (failedPages > 0) {
      limitations.push(`${failedPages} of ${pageAudits.length} crawled page(s) could not be audited (fetch failure, robots.txt block, or audit rejection); see each entry's error.`);
    }

    const result: SiteAuditResult = {
      requestId,
      startUrl,
      pagesCrawled: crawl.pages.length,
      pageAudits,
      siteFindings,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "site-audit-orchestrator",
      eventType: "site_audit_completed",
      details: { requestId, pagesCrawled: crawl.pages.length, pagesAudited: pageAudits.length - failedPages, siteFindingCount: siteFindings.length },
    });

    return result;
  }
}
