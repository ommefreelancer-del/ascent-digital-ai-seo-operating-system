// Structural validation and low-confidence detection for an incoming
// ContactIntelligenceRequest. Structural problems (empty campaign
// requirements) throw immediately, per GLOBAL_RULES.md SS11. Low-confidence
// detection does NOT throw -- it is checked against the already-built
// verified/unverified record lists, the same way PublisherQualificationRequestValidator
// checks its own signal against post-qualification data rather than the
// raw request.

import type { ContactIntelligenceRequest, ContactRecord } from "../types/contact-intelligence-request.types.js";

export class ContactIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactIntelligenceValidationError";
  }
}

export class ContactIntelligenceRequestValidator {
  /** Throws ContactIntelligenceValidationError if the request is structurally invalid. */
  validate(request: ContactIntelligenceRequest): void {
    if (!request.campaignRequirements.trim()) {
      throw new ContactIntelligenceValidationError("campaignRequirements must not be empty.");
    }
  }

  /**
   * True only when real discovery was attempted (at least one provider
   * snapshot was obtained) but nothing could be verified -- a genuinely
   * thin outcome worth a human's attention before an empty verified list
   * moves on to the Outreach Agent. When no discovery was attempted at
   * all, this is `false` -- that gap is a limitation, not a judgment call
   * being made on missing data.
   */
  looksLowConfidence(
    verifiedRecords: readonly ContactRecord[],
    unverifiedRecords: readonly ContactRecord[],
    dataAvailable: boolean,
  ): boolean {
    if (!dataAvailable) {
      return false;
    }
    return verifiedRecords.length === 0 && unverifiedRecords.length > 0;
  }
}
