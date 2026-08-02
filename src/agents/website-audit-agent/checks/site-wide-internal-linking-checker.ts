// Site-wide internal linking signals derived directly from what the crawler
// actually observed: `discoveredFrom` records how each page was first
// reached during the crawl (another page's link, "sitemap.xml", or `null`
// for the start page). A page reachable only via the sitemap and never
// linked from any crawled page is a real orphan-page signal -- it depends
// entirely on the sitemap for discovery, which is a known SEO risk.

import type { SiteAuditChecker } from "./site-audit-checker.js";
import type { WebsiteCrawlResult } from "../../../core/crawling/website-crawler.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class SiteWideInternalLinkingChecker implements SiteAuditChecker {
  readonly category = "site-wide-internal-linking";

  check(crawl: WebsiteCrawlResult): AuditFinding[] {
    const successfulPages = crawl.pages.filter((page) => page.html !== null);
    const orphans = successfulPages.filter((page) => page.discoveredFrom === "sitemap.xml");

    const findings: AuditFinding[] = [];

    if (orphans.length > 0) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `${orphans.length} page(s) were found only via sitemap.xml, with no internal link from any crawled page pointing to them: ${orphans
          .slice(0, 5)
          .map((p) => p.url)
          .join(", ")}${orphans.length > 5 ? ", ..." : ""}.`,
        recommendation: "Add internal links to these pages from relevant, already-linked pages so users and crawlers can discover them without relying on the sitemap alone.",
      });
    } else if (successfulPages.length > 1) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No orphaned pages were found; every crawled page (besides the start page) was reached via an internal link.",
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
