// Checks the page's own <meta name="robots"> directive. This is the one
// crawlability signal fully available from the supplied HTML alone; HTTP-header
// -level signals (X-Robots-Tag) require the real response headers, which this
// deterministic, no-fetch build does not have -- WebsiteAuditAgent states
// that limitation explicitly rather than silently ignoring it.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class CrawlabilityChecker implements AuditChecker {
  readonly category = "crawlability";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!facts.metaRobots) {
      findings.push({
        category: this.category,
        severity: "info",
        message: 'No <meta name="robots"> tag was found.',
        recommendation: "No action required; the page defaults to index, follow.",
      });
      return findings;
    }

    const value = facts.metaRobots.toLowerCase();
    if (value.includes("noindex")) {
      findings.push({
        category: this.category,
        severity: "critical",
        message: `A <meta name="robots"> tag with "noindex" was found (content="${facts.metaRobots}").`,
        recommendation:
          "Remove the noindex directive if this page should appear in search results, or confirm it is intentional.",
      });
    }
    if (value.includes("nofollow")) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `A <meta name="robots"> tag with "nofollow" was found (content="${facts.metaRobots}").`,
        recommendation: "Confirm this page's outbound links are intentionally not being followed by search engines.",
      });
    }

    return findings;
  }
}
