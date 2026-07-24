// Structural validation and low-confidence detection for an incoming
// ProspectingRequest. Structural problems (empty campaign requirements,
// niche, country, or language) throw immediately, per GLOBAL_RULES.md
// SS11. Low-confidence detection does NOT throw -- it is checked against
// the already-processed prospect list (after real discovery, deduplication,
// and confidence-scoring), the same way OffPageSeoRequestValidator checks
// its own toxic-backlink signal against post-fetch data rather than the
// raw request.

import type { Prospect, ProspectingRequest } from "../types/prospecting-request.types.js";

export class ProspectingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProspectingValidationError";
  }
}

export class ProspectingRequestValidator {
  /** Throws ProspectingValidationError if the request is structurally invalid. */
  validate(request: ProspectingRequest): void {
    if (!request.campaignRequirements.trim()) {
      throw new ProspectingValidationError("campaignRequirements must not be empty.");
    }
    if (!request.targetNiche.trim()) {
      throw new ProspectingValidationError("targetNiche must not be empty.");
    }
    if (!request.targetCountry.trim()) {
      throw new ProspectingValidationError("targetCountry must not be empty.");
    }
    if (!request.targetLanguage.trim()) {
      throw new ProspectingValidationError("targetLanguage must not be empty.");
    }
  }

  /**
   * True only when a real provider ran but the resulting evidence is thin:
   * zero prospects were found, or every real prospect scored low
   * confidence. When no provider is configured at all, this is `false` --
   * that gap is reported as a limitation, not escalated, since no
   * conclusion is being drawn from data that was never sought.
   */
  looksLowConfidence(prospects: readonly Prospect[], dataAvailable: boolean): boolean {
    if (!dataAvailable) {
      return false;
    }
    return prospects.length === 0 || prospects.every((prospect) => prospect.confidence === "low");
  }
}
