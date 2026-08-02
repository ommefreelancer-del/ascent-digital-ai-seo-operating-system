// Accessibility signals derivable from markup alone -- no rendering, no
// computed styles, no contrast analysis (that would require actually
// rendering the page, out of scope for this structural, non-browser audit).
// Covers: links with no accessible name, generic/non-descriptive link text,
// and a missing <main> landmark. Heading structure and image alt text are
// already covered by HeadingStructureChecker and ImageAltChecker.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

const IGNORED_SCHEMES = ["mailto:", "tel:", "javascript:"];
const GENERIC_LINK_TEXTS = new Set(["click here", "here", "read more", "learn more", "more", "link"]);

export class AccessibilityChecker implements AuditChecker {
  readonly category = "accessibility";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const realLinks = facts.links.filter((link) => {
      const href = link.href.trim();
      return href !== "" && href !== "#" && !IGNORED_SCHEMES.some((scheme) => href.startsWith(scheme));
    });

    const noAccessibleName = realLinks.filter((link) => !link.text && !link.ariaLabel);
    if (noAccessibleName.length > 0) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `${noAccessibleName.length} link(s) have no visible text and no aria-label, so screen readers cannot announce their purpose.`,
        recommendation: "Add descriptive link text or an aria-label to every link.",
      });
    }

    const genericText = realLinks.filter((link) => GENERIC_LINK_TEXTS.has(link.text.toLowerCase()) && !link.ariaLabel);
    if (genericText.length > 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `${genericText.length} link(s) use generic text (e.g. "click here", "read more") that is not descriptive out of context.`,
        recommendation: "Use link text that describes the destination, or add an aria-label.",
      });
    }

    if (!facts.hasMainLandmark) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No <main> element or role=\"main\" landmark was found.",
        recommendation: 'Wrap the page\'s primary content in a <main> element so assistive technology can identify it.',
      });
    }

    return findings;
  }
}
