// Checks heading structure: exactly one <h1>, and no skipped heading levels
// (e.g. h1 straight to h3). Purely structural, computed from the headings
// already extracted from the HTML -- no external data involved.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export class HeadingStructureChecker implements AuditChecker {
  readonly category = "headings";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const h1Count = facts.headings.filter((heading) => heading.level === 1).length;

    if (h1Count === 0) {
      findings.push({
        category: this.category,
        severity: "critical",
        message: "No <h1> heading was found.",
        recommendation: "Add exactly one <h1> describing the page's main topic.",
      });
    } else if (h1Count > 1) {
      findings.push({
        category: this.category,
        severity: "warning",
        message: `${h1Count} <h1> headings were found; expected exactly one.`,
        recommendation: "Use a single <h1> per page and demote additional ones to <h2> or lower.",
      });
    }

    let previousLevel = 0;
    for (const heading of facts.headings) {
      if (previousLevel > 0 && heading.level > previousLevel + 1) {
        findings.push({
          category: this.category,
          severity: "warning",
          message: `Heading level jumps from h${previousLevel} to h${heading.level} ("${heading.text}"), skipping a level.`,
          recommendation: "Avoid skipping heading levels; each heading should step down by one level at a time.",
        });
      }
      previousLevel = heading.level;
    }

    return findings;
  }
}
