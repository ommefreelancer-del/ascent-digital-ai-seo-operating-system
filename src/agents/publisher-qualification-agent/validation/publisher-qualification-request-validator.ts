// Structural validation and low-confidence detection for an incoming
// PublisherQualificationRequest. Structural problems (empty campaign
// requirements or target niche) throw immediately, per GLOBAL_RULES.md
// SS11. Low-confidence detection does NOT throw -- it is checked against
// the already-qualified prospect lists, the same way ProspectingRequestValidator
// checks its own signal against post-discovery data rather than the raw
// request.

import type { PublisherQualificationRequest, QualifiedProspect } from "../types/publisher-qualification-request.types.js";

export class PublisherQualificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherQualificationValidationError";
  }
}

export class PublisherQualificationRequestValidator {
  /** Throws PublisherQualificationValidationError if the request is structurally invalid. */
  validate(request: PublisherQualificationRequest): void {
    if (!request.campaignRequirements.trim()) {
      throw new PublisherQualificationValidationError("campaignRequirements must not be empty.");
    }
    if (!request.targetNiche.trim()) {
      throw new PublisherQualificationValidationError("targetNiche must not be empty.");
    }
  }

  /**
   * True only when real quality evidence was obtained (at least one
   * prospect was actually evaluated against real data) but nothing was
   * approved -- a genuinely thin outcome worth a human's attention before
   * an empty list moves on to Contact Intelligence. When no evidence was
   * available at all, this is `false` -- that gap is a limitation, not a
   * judgment call being made on missing data.
   */
  looksLowConfidence(
    approvedProspects: readonly QualifiedProspect[],
    rejectedProspects: readonly QualifiedProspect[],
    dataAvailable: boolean,
  ): boolean {
    if (!dataAvailable) {
      return false;
    }
    return approvedProspects.length === 0 && rejectedProspects.length > 0;
  }
}
