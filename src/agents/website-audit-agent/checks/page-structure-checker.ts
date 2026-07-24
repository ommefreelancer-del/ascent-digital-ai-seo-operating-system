// Checks basic page structure: doctype, html lang attribute, viewport meta
// tag, and structured-data JSON validity. All purely structural facts about
// the supplied HTML -- no external data involved.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class PageStructureChecker implements AuditChecker {
  readonly category = "page-structure";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!facts.hasDoctype) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No <!DOCTYPE html> declaration was found.",
        recommendation: "Add a standard HTML5 doctype declaration.",
      });
    }

    if (!facts.htmlLang) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "The <html> tag has no lang attribute.",
        recommendation: 'Add a lang attribute (e.g. lang="en") for accessibility and locale signaling.',
      });
    }

    if (!facts.hasViewportMeta) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No viewport meta tag was found.",
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile responsiveness.',
      });
    }

    if (facts.structuredDataBlocks.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No structured data (application/ld+json) was found.",
        recommendation: "Consider adding relevant Schema.org structured data.",
      });
    } else {
      for (const block of facts.structuredDataBlocks) {
        try {
          JSON.parse(block);
        } catch {
          findings.push({
            category: this.category,
            severity: "warning",
            message: "A structured data (application/ld+json) block contains invalid JSON.",
            recommendation: "Fix the JSON syntax so search engines can parse the structured data.",
          });
        }
      }
    }

    return findings;
  }
}
