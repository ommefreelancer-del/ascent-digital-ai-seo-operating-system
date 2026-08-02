// Checks for the minimum Open Graph tags search engines and social
// platforms expect when a page is shared (og:title, og:description,
// og:image, og:url, og:type). Evidence-based: only reports tags that are
// genuinely absent from the extracted facts, never guesses their intended
// content.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

const REQUIRED_OG_KEYS = ["og:title", "og:description", "og:image", "og:url", "og:type"];

export class OpenGraphChecker implements AuditChecker {
  readonly category = "open-graph";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const present = new Set(facts.openGraphTags.map((tag) => tag.key.toLowerCase()));
    const missing = REQUIRED_OG_KEYS.filter((key) => !present.has(key));

    if (facts.openGraphTags.length === 0) {
      return [
        {
          category: this.category,
          severity: "warning",
          message: "No Open Graph meta tags were found.",
          recommendation: `Add Open Graph tags (${REQUIRED_OG_KEYS.join(", ")}) so shared links render correctly on social platforms.`,
        },
      ];
    }

    if (missing.length > 0) {
      return [
        {
          category: this.category,
          severity: "warning",
          message: `Missing Open Graph tag(s): ${missing.join(", ")}.`,
          recommendation: `Add the missing Open Graph tag(s): ${missing.join(", ")}.`,
        },
      ];
    }

    return [
      {
        category: this.category,
        severity: "info",
        message: "All core Open Graph tags are present.",
        recommendation: "No action required.",
      },
    ];
  }
}
