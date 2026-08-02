// Flags real redirect chains recorded by the crawler (WebsiteCrawler tracks
// every hop it actually followed). A single redirect (2 entries in the
// chain) is normal and only worth noting; two or more redirect hops before
// reaching the final page is worth fixing (each hop costs crawl budget and
// adds latency).

import type { SiteAuditChecker } from "./site-audit-checker.js";
import type { WebsiteCrawlResult } from "../../../core/crawling/website-crawler.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class RedirectChainChecker implements SiteAuditChecker {
  readonly category = "redirect-chains";

  check(crawl: WebsiteCrawlResult): AuditFinding[] {
    const redirected = crawl.pages.filter((page) => page.redirectChain.length > 1);

    if (redirected.length === 0) {
      return [
        {
          category: this.category,
          severity: "info",
          message: "No redirects were encountered while crawling.",
          recommendation: "No action required.",
        },
      ];
    }

    const findings: AuditFinding[] = [];
    for (const page of redirected) {
      const hops = page.redirectChain.length - 1;
      findings.push({
        category: this.category,
        severity: hops >= 2 ? "warning" : "info",
        message: `${page.url} resolved through ${hops} redirect hop(s): ${page.redirectChain.join(" -> ")}.`,
        recommendation:
          hops >= 2
            ? "Update the source link(s) to point directly at the final URL, removing intermediate redirect hops."
            : "A single redirect is generally fine; consider linking directly to the final URL where practical.",
      });
    }
    return findings;
  }
}
