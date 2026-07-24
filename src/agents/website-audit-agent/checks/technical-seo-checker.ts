// Basic technical SEO check achievable without fetching anything: whether
// the audited URL itself (if supplied) uses HTTPS.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class TechnicalSeoChecker implements AuditChecker {
  readonly category = "technical-seo";

  check(_facts: ExtractedHtmlFacts, context: AuditCheckContext): AuditFinding[] {
    if (!context.url) {
      return [
        {
          category: this.category,
          severity: "info",
          message: "No URL was supplied; HTTPS could not be checked.",
          recommendation: "Supply the page's URL to check its protocol.",
        },
      ];
    }

    let scheme: string | null;
    try {
      scheme = new URL(context.url).protocol;
    } catch {
      scheme = null;
    }

    if (scheme === "http:") {
      return [
        {
          category: this.category,
          severity: "critical",
          message: 'The audited URL uses "http://" rather than "https://".',
          recommendation: "Serve the page over HTTPS; it is a confirmed ranking and trust signal.",
        },
      ];
    }

    if (scheme === "https:") {
      return [
        {
          category: this.category,
          severity: "info",
          message: "The audited URL uses HTTPS.",
          recommendation: "No action required.",
        },
      ];
    }

    return [];
  }
}
