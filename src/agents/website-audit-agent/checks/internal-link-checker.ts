// Checks internal/external link counts and flags empty or placeholder
// hrefs. "Internal" vs "external" is determined by comparing each link's
// host against the audited URL's own host (if supplied); with no URL,
// relative links are still counted as internal.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

const IGNORED_SCHEMES = ["mailto:", "tel:", "javascript:"];

export class InternalLinkChecker implements AuditChecker {
  readonly category = "internal-links";

  check(facts: ExtractedHtmlFacts, context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const placeholderHrefs = facts.links.filter((link) => {
      const href = link.href.trim();
      return href === "" || href === "#";
    });
    if (placeholderHrefs.length > 0) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `${placeholderHrefs.length} link(s) have an empty or placeholder href ("#").`,
        recommendation: "Replace placeholder links with real destinations or remove them.",
      });
    }

    let pageHost: string | null = null;
    if (context.url) {
      try {
        pageHost = new URL(context.url).host;
      } catch {
        pageHost = null;
      }
    }

    let internalCount = 0;
    let externalCount = 0;
    for (const link of facts.links) {
      const href = link.href.trim();
      if (!href || href === "#" || IGNORED_SCHEMES.some((scheme) => href.startsWith(scheme))) {
        continue;
      }
      if (/^https?:\/\//i.test(href)) {
        let linkHost: string | null;
        try {
          linkHost = new URL(href).host;
        } catch {
          linkHost = null;
        }
        if (pageHost && linkHost === pageHost) {
          internalCount += 1;
        } else {
          externalCount += 1;
        }
      } else {
        internalCount += 1;
      }
    }

    if (internalCount === 0) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No internal links were found on this page.",
        recommendation: "Add internal links to related pages to support crawlability and topical authority.",
      });
    } else {
      findings.push({
        category: this.category,
        severity: "info",
        message: `Found ${internalCount} internal link(s) and ${externalCount} external link(s).`,
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
