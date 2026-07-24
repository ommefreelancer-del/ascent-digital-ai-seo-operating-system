// Checks presence and length of the page's <title> and meta description.
// Length ranges are general, widely-published SEO conventions (not derived
// from any specific ranking data this agent doesn't have) and are worded as
// recommendations, never guarantees.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

export class MetadataChecker implements AuditChecker {
  readonly category = "metadata";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!facts.title) {
      findings.push({
        category: this.category,
        severity: "critical",
        message: "No <title> tag was found.",
        recommendation: "Add a unique, descriptive <title> tag.",
      });
    } else if (facts.title.length < TITLE_MIN) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `Title is only ${facts.title.length} character(s): "${facts.title}".`,
        recommendation: `Consider a more descriptive title, generally ${TITLE_MIN}-${TITLE_MAX} characters.`,
      });
    } else if (facts.title.length > TITLE_MAX) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `Title is ${facts.title.length} characters and may be truncated in search results: "${facts.title}".`,
        recommendation: `Consider shortening to roughly ${TITLE_MIN}-${TITLE_MAX} characters.`,
      });
    }

    if (!facts.metaDescription) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: "No meta description was found.",
        recommendation: "Add a meta description summarizing the page's content.",
      });
    } else if (facts.metaDescription.length < DESCRIPTION_MIN) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `Meta description is only ${facts.metaDescription.length} character(s).`,
        recommendation: `Consider expanding to roughly ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
      });
    } else if (facts.metaDescription.length > DESCRIPTION_MAX) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `Meta description is ${facts.metaDescription.length} characters and may be truncated in search results.`,
        recommendation: `Consider shortening to roughly ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
      });
    }

    return findings;
  }
}
