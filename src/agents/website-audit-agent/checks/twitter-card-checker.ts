// Checks for a Twitter/X Card meta tag. Only twitter:card is treated as
// required (it's what actually activates card rendering); twitter:title and
// twitter:description are checked only when a card type is declared, since
// platforms fall back to Open Graph tags for those when absent.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class TwitterCardChecker implements AuditChecker {
  readonly category = "twitter-card";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const keys = new Set(facts.twitterCardTags.map((tag) => tag.key.toLowerCase()));

    if (!keys.has("twitter:card")) {
      return [
        {
          category: this.category,
          severity: "info",
          message: "No twitter:card meta tag was found.",
          recommendation:
            'Add <meta name="twitter:card" content="summary_large_image"> (or "summary") to control how links render on X/Twitter.',
        },
      ];
    }

    const findings: AuditFinding[] = [
      {
        category: this.category,
        severity: "info",
        message: "A twitter:card meta tag is present.",
        recommendation: "No action required.",
      },
    ];

    if (!keys.has("twitter:title") && !facts.title) {
      findings.push({
        category: this.category,
        severity: "info",
        message: "No twitter:title tag and no <title> tag to fall back on.",
        recommendation: "Add a twitter:title tag or a page <title> so the card has a title to display.",
      });
    }

    return findings;
  }
}
