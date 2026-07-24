// Structural validation for an incoming CampaignTrackingRequest. This
// agent makes no approve/reject judgment call -- it only aggregates real,
// already-computed outreach status and real, caller-supplied campaign
// updates into a report -- so unlike the other pipeline agents, it has no
// low-confidence or policy-risk signal to check. Only a genuine structural
// problem (an empty campaign name) throws, per GLOBAL_RULES.md SS11.

import type { CampaignTrackingRequest } from "../types/campaign-tracking-request.types.js";

export class CampaignTrackingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignTrackingValidationError";
  }
}

export class CampaignTrackingRequestValidator {
  /** Throws CampaignTrackingValidationError if the request is structurally invalid. */
  validate(request: CampaignTrackingRequest): void {
    if (!request.campaignName.trim()) {
      throw new CampaignTrackingValidationError("campaignName must not be empty.");
    }
  }
}
