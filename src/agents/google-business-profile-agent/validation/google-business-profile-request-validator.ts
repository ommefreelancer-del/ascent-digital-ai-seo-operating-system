// Structural validation and Google-policy risk detection for an incoming
// GoogleBusinessProfileRequest. Structural problems (empty business name,
// url, or NAP fields) throw immediately, per GLOBAL_RULES.md SS11. Policy-
// risk detection does NOT throw -- it returns the matched signals so the
// caller (GoogleBusinessProfileAgent) can escalate to a human per
// GLOBAL_RULES.md SS6/SS13, the same findPolicyRiskSignals() shape
// KeywordRequestValidator/OnPageSeoRequestValidator/SeoContentRequestValidator
// use for their own signals -- here reflecting this agent's own rules
// ("Follow Google's Business Profile policies", "Never create fake reviews
// or misleading content").

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { GoogleBusinessProfileRequest } from "../types/google-business-profile-request.types.js";

export class GoogleBusinessProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBusinessProfileValidationError";
  }
}

/**
 * Terms associated with Google Business Profile policy violations (fake or
 * incentivized reviews, keyword-stuffed business names, fake addresses) --
 * per Google's own Business Profile guidelines.
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /fake\s*review/i, label: "fake reviews" },
  { pattern: /buy\s*review/i, label: "purchased reviews" },
  { pattern: /incentiviz\w*\s*review/i, label: "incentivized reviews" },
  { pattern: /keyword\s*stuff/i, label: "keyword stuffing" },
  { pattern: /virtual\s*office/i, label: "virtual office address" },
  { pattern: /fake\s*address/i, label: "fake address" },
];

export class GoogleBusinessProfileRequestValidator {
  /** Throws GoogleBusinessProfileValidationError if the request is structurally invalid. */
  validate(request: GoogleBusinessProfileRequest): void {
    if (!request.businessName.trim()) {
      throw new GoogleBusinessProfileValidationError("businessName must not be empty.");
    }
    if (!request.websiteUrl.trim()) {
      throw new GoogleBusinessProfileValidationError("websiteUrl must not be empty.");
    }
    if (!request.expectedNap.name.trim() || !request.expectedNap.address.trim() || !request.expectedNap.phone.trim()) {
      throw new GoogleBusinessProfileValidationError("expectedNap must include a non-empty name, address, and phone.");
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: GoogleBusinessProfileRequest): string[] {
    const haystack = [request.businessName, request.localSeoStrategy ?? ""].join(" ");
    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
