// Checks robots directives (Disallow rules) and sitemap references from the
// site's real robots.txt content -- supplied by the caller, never fetched.
// Both checks share the same input source (robotsTxtContent), which is why
// they're grouped in one checker.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class RobotsTxtChecker implements AuditChecker {
  readonly category = "robots-txt";

  check(_facts: ExtractedHtmlFacts, context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!context.robotsTxtContent) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No robots.txt content was supplied.",
        recommendation: "Supply robotsTxtContent to check Disallow rules and Sitemap references for this URL.",
      });
      return findings;
    }

    const lines = context.robotsTxtContent.split(/\r\n|\r|\n/).map((line) => line.trim());
    const disallowPaths = lines
      .filter((line) => /^disallow:/i.test(line))
      .map((line) => line.replace(/^disallow:/i, "").trim())
      .filter((path) => path.length > 0);
    const hasSitemapReference = lines.some((line) => /^sitemap:/i.test(line));

    if (!hasSitemapReference) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No Sitemap: reference was found in the supplied robots.txt content.",
        recommendation: "Add a Sitemap: line to robots.txt to help search engines discover the XML sitemap.",
      });
    }

    if (context.url) {
      let path: string | null;
      try {
        path = new URL(context.url).pathname;
      } catch {
        path = null;
      }
      if (path !== null) {
        const blockingRule = disallowPaths.find((rule) => path !== null && path.startsWith(rule));
        if (blockingRule) {
          findings.push({
            category: this.category,
            severity: "critical",
            message: `robots.txt contains "Disallow: ${blockingRule}", which blocks the audited URL's path "${path}".`,
            recommendation: "Remove or narrow this Disallow rule if this page should be crawlable.",
          });
        }
      }
    }

    return findings;
  }
}
