// Structural validation and low-confidence detection for an incoming
// OutreachRequest. Structural problems (empty campaign requirements) throw
// immediately, per GLOBAL_RULES.md SS11. Low-confidence detection does NOT
// throw -- it is checked against the already-built draft/skipped lists, the
// same way ContactIntelligenceRequestValidator checks its own signal
// against post-discovery data rather than the raw request.

import type { OutreachDraft, OutreachRequest, SkippedPublisher } from "../types/outreach-request.types.js";

export class OutreachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachValidationError";
  }
}

export class OutreachRequestValidator {
  /** Throws OutreachValidationError if the request is structurally invalid. */
  validate(request: OutreachRequest): void {
    if (!request.campaignRequirements.trim()) {
      throw new OutreachValidationError("campaignRequirements must not be empty.");
    }
  }

  /**
   * True only when real verified contact data was available overall but
   * every approved publisher had to be skipped (no matching verified
   * contact) -- a genuinely thin outcome worth a human's attention before
   * an empty draft list moves on. When no verified contact data was
   * available at all, this is `false` -- that gap is a limitation, not a
   * judgment call being made on missing data.
   */
  looksLowConfidence(
    outreachDrafts: readonly OutreachDraft[],
    skippedPublishers: readonly SkippedPublisher[],
    dataAvailable: boolean,
  ): boolean {
    if (!dataAvailable) {
      return false;
    }
    return outreachDrafts.length === 0 && skippedPublishers.length > 0;
  }
}
