// Mobile-friendliness signals derivable from markup alone. PageStructureChecker
// already flags a completely missing viewport meta tag; this checker goes
// further and evaluates the tag's actual content -- present-but-useless
// (missing width=device-width) and present-but-harmful (blocking pinch-zoom)
// are both real, distinct problems a bare presence check would miss.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class MobileFriendlinessChecker implements AuditChecker {
  readonly category = "mobile-friendliness";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!facts.hasViewportMeta || !facts.viewportContent) {
      findings.push({
        category: this.category,
        severity: "critical",
        message: "No viewport meta tag was found, so mobile browsers will render the page at desktop width.",
        recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      });
      return findings;
    }

    const content = facts.viewportContent.toLowerCase();

    if (!content.includes("width=device-width")) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `The viewport meta tag does not include "width=device-width" (content: "${facts.viewportContent}").`,
        recommendation: 'Include width=device-width in the viewport content so the page scales to the device width.',
      });
    }

    if (/user-scalable\s*=\s*no/.test(content) || /maximum-scale\s*=\s*1(\.0*)?(?!\d)/.test(content)) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "The viewport meta tag disables pinch-to-zoom (user-scalable=no or maximum-scale=1).",
        recommendation: "Allow users to zoom for accessibility; avoid user-scalable=no and restrictive maximum-scale values.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "The viewport meta tag is configured for responsive mobile rendering.",
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
