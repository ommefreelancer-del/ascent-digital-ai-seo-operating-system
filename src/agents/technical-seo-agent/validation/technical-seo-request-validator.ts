// Structural validation and ambiguity detection for an incoming
// TechnicalSeoRequest. Structural/data-integrity problems throw
// immediately (a real mismatch between the two supplied inputs, per
// GLOBAL_RULES.md SS11 "report inconsistencies instead of silently
// correcting them"). A genuinely ambiguous *situation* (not an input error)
// is reported via looksAmbiguous() so the caller can escalate to a human
// per GLOBAL_RULES.md SS13 instead of guessing which fix to prioritize.

import type { TechnicalSeoRequest } from "../types/technical-seo-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export class TechnicalSeoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TechnicalSeoValidationError";
  }
}

// Matches exactly what CrossFunctionalNotesBuilder produces:
// `[${category}, ${severity}] ${message} (outside On-Page SEO Agent's scope -- coordinate with the Technical SEO Agent.)`
const NOTE_PATTERN = /^\[([a-z-]+), (info|warning|critical)\] (.+) \(outside/;

export class TechnicalSeoRequestValidator {
  /** Throws TechnicalSeoValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: TechnicalSeoRequest): void {
    for (const note of request.crossFunctionalNotes) {
      const match = NOTE_PATTERN.exec(note);
      if (!match) {
        throw new TechnicalSeoValidationError(
          `crossFunctionalNotes entry does not match the expected format: "${note}".`,
        );
      }
      const category = match[1];
      const severity = match[2];
      const message = match[3];
      if (category === undefined || severity === undefined || message === undefined) {
        throw new TechnicalSeoValidationError(
          `crossFunctionalNotes entry does not match the expected format: "${note}".`,
        );
      }
      const correlates = request.websiteAudit.findings.some(
        (finding) => finding.category === category && finding.severity === severity && finding.message === message,
      );
      if (!correlates) {
        throw new TechnicalSeoValidationError(
          `crossFunctionalNotes references a finding not present in the supplied websiteAudit: "${note}".`,
        );
      }
    }
  }

  /**
   * True when the page is blocked from indexing by two independent
   * mechanisms at once (a noindex meta directive *and* a robots.txt
   * Disallow rule). Not necessarily a mistake -- it could be a deliberately
   * excluded staging/internal page -- so this is escalated rather than
   * silently recommending both fixes.
   */
  looksAmbiguous(websiteAudit: WebsiteAuditResult): boolean {
    const hasNoindex = websiteAudit.findings.some(
      (finding) => finding.category === "crawlability" && finding.message.toLowerCase().includes("noindex"),
    );
    const hasDisallow = websiteAudit.findings.some(
      (finding) => finding.category === "robots-txt" && finding.message.toLowerCase().includes("disallow"),
    );
    return hasNoindex && hasDisallow;
  }
}
