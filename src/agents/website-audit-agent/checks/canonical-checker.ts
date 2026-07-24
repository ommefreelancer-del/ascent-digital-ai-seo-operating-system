// Checks for a canonical <link> tag, and -- if the page's own URL was
// supplied -- whether the canonical target matches it. A mismatch is
// reported as informational (cross-URL canonicalization is often
// deliberate), not an error.

import { normalizeUrl } from "../util/normalize-url.js";
import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class CanonicalChecker implements AuditChecker {
  readonly category = "canonical";

  check(facts: ExtractedHtmlFacts, context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!facts.canonicalHref) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No canonical <link> tag was found.",
        recommendation: "Add a self-referencing canonical tag to avoid duplicate-content ambiguity.",
      });
      return findings;
    }

    if (context.url) {
      const normalizedCanonical = normalizeUrl(facts.canonicalHref, context.url);
      const normalizedPageUrl = normalizeUrl(context.url, context.url);
      if (normalizedCanonical !== null && normalizedPageUrl !== null && normalizedCanonical !== normalizedPageUrl) {
        findings.push({
          category: this.category,
          severity: "info",
          message: `Canonical tag points to "${facts.canonicalHref}", which differs from the audited URL "${context.url}".`,
          recommendation: "Confirm this is intentional (e.g. deliberate cross-URL canonicalization) rather than a mistake.",
        });
      }
    }

    return findings;
  }
}
