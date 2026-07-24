// Checks images for a missing alt attribute (accessibility and image SEO).
// Distinguishes "attribute entirely absent" (alt === null) from "present
// but empty" (alt === ""), since an empty alt is a valid, deliberate choice
// for purely decorative images -- flagging only the former avoids a
// misleading finding.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class ImageAltChecker implements AuditChecker {
  readonly category = "image-alt";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (facts.images.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No <img> tags were found on this page.",
        recommendation: "No action required.",
      });
      return findings;
    }

    const missingAlt = facts.images.filter((image) => image.alt === null);
    if (missingAlt.length > 0) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `${missingAlt.length} of ${facts.images.length} image(s) are missing an alt attribute entirely.`,
        recommendation: "Add a descriptive alt attribute to every meaningful image for accessibility and image SEO.",
      });
    } else {
      findings.push({
        category: this.category,
        severity: "info",
        message: `All ${facts.images.length} image(s) have an alt attribute.`,
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
