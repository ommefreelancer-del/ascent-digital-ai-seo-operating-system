// Structural validation for an incoming ReplyNegotiationRequest.
// Structural problems (an empty currency, a non-positive target price, or
// a maximum acceptable price below the target price) throw immediately,
// per GLOBAL_RULES.md SS11 -- these are genuine caller-input errors, not
// judgment calls.

import type { ReplyNegotiationRequest } from "../types/reply-negotiation-request.types.js";

export class ReplyNegotiationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyNegotiationValidationError";
  }
}

export class ReplyNegotiationRequestValidator {
  /** Throws ReplyNegotiationValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: ReplyNegotiationRequest): void {
    if (!request.targetPricing.currency.trim()) {
      throw new ReplyNegotiationValidationError("targetPricing.currency must not be empty.");
    }
    if (request.targetPricing.targetPrice <= 0) {
      throw new ReplyNegotiationValidationError("targetPricing.targetPrice must be a positive number.");
    }
    if (request.targetPricing.maxAcceptablePrice < request.targetPricing.targetPrice) {
      throw new ReplyNegotiationValidationError(
        "targetPricing.maxAcceptablePrice must not be less than targetPricing.targetPrice.",
      );
    }
  }
}
