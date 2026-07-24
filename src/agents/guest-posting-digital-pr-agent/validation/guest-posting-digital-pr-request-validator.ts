// Structural validation for an incoming GuestPostingDigitalPrRequest. A
// blank real campaignName throws immediately, per GLOBAL_RULES.md SS11.
// This agent makes no judgment call of its own -- every other field is an
// already-real, already-decided upstream result -- so there is no
// policy-risk or destructive-action scan here, matching the precedent set
// by CampaignTrackingAgent/AiCrmAgent.

import type { GuestPostingDigitalPrRequest } from "../types/guest-posting-digital-pr-request.types.js";

export class GuestPostingDigitalPrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestPostingDigitalPrValidationError";
  }
}

export class GuestPostingDigitalPrRequestValidator {
  validate(request: GuestPostingDigitalPrRequest): void {
    if (!request.campaignName.trim()) {
      throw new GuestPostingDigitalPrValidationError("campaignName must not be empty.");
    }
  }
}
