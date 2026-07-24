// Structural validation and policy-risk detection for an incoming
// OffPageSeoRequest. Structural problems (empty url/businessObjective, a
// genuine cross-input mismatch) throw immediately, per GLOBAL_RULES.md SS11
// "report inconsistencies instead of silently correcting them". Policy-risk
// detection does NOT throw -- it returns the matched signals so the caller
// (OffPageSeoAgent) can escalate to a human per GLOBAL_RULES.md SS13, the
// same findPolicyRiskSignals() shape KeywordRequestValidator and
// OnPageSeoRequestValidator use for their own (text-pattern-based) signals.
// Here the signal comes from real provider data instead of text patterns:
// acting on a toxicity flag by disavowing a legitimate link can itself harm
// the site's authority, so it is never applied automatically.

import type { OffPageSeoRequest, ToxicBacklinkInsight } from "../types/off-page-seo-request.types.js";

export class OffPageSeoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffPageSeoValidationError";
  }
}

export class OffPageSeoRequestValidator {
  /** Throws OffPageSeoValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: OffPageSeoRequest): void {
    if (!request.url.trim()) {
      throw new OffPageSeoValidationError("url must not be empty.");
    }
    if (!request.businessObjective.trim()) {
      throw new OffPageSeoValidationError("businessObjective must not be empty.");
    }
    if (request.websiteAudit.url !== null && request.websiteAudit.url !== request.url) {
      throw new OffPageSeoValidationError(
        `websiteAudit appears to describe a different page ("${request.websiteAudit.url}") than the ` +
          `requested url ("${request.url}").`,
      );
    }
  }

  /** Returns a description of every toxic-backlink signal found; empty if none. */
  findPolicyRiskSignals(toxicBacklinks: readonly ToxicBacklinkInsight[]): string[] {
    if (toxicBacklinks.length === 0) {
      return [];
    }
    return [`${toxicBacklinks.length} toxic referring domain(s) flagged by the backlink data provider`];
  }
}
