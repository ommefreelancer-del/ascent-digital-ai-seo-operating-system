// Structural validation and policy-risk detection for an incoming
// BusinessDevelopmentRequest. Structural problems (empty business goals, a
// blank service portfolio field) throw immediately, per GLOBAL_RULES.md
// SS11. Policy-risk detection does NOT throw -- it returns the matched
// signals so the caller (BusinessDevelopmentAgent) can escalate to a human
// per GLOBAL_RULES.md SS13, reflecting this agent's own rule "never make
// false promises to prospects."

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { BusinessDevelopmentRequest } from "../types/business-development-request.types.js";

export class BusinessDevelopmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessDevelopmentValidationError";
  }
}

/**
 * Terms associated with false or unverifiable promises to prospects --
 * directly reflecting this agent's own rule "never make false promises to
 * prospects."
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /guarantee/i, label: "guaranteed results" },
  { pattern: /100%\s*(success|results?)/i, label: "absolute success claims" },
  { pattern: /(top|#1|number\s*one|first)\s*(ranking|rank|position)/i, label: "guaranteed ranking claims" },
  { pattern: /risk[\s-]?free/i, label: "risk-free claims" },
];

export class BusinessDevelopmentRequestValidator {
  /** Throws BusinessDevelopmentValidationError if the request is structurally invalid. */
  validate(request: BusinessDevelopmentRequest): void {
    if (!request.businessGoals.trim()) {
      throw new BusinessDevelopmentValidationError("businessGoals must not be empty.");
    }
    for (const item of request.servicePortfolio) {
      if (!item.serviceName.trim()) {
        throw new BusinessDevelopmentValidationError("Every servicePortfolio item must have a non-empty serviceName.");
      }
      if (!item.priceRangeLabel.trim()) {
        throw new BusinessDevelopmentValidationError(
          `servicePortfolio item "${item.serviceName}" must have a non-empty priceRangeLabel.`,
        );
      }
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: BusinessDevelopmentRequest): string[] {
    const haystack = [
      request.businessGoals,
      request.marketResearch ?? "",
      ...request.servicePortfolio.flatMap((item) => [item.serviceName, item.description]),
    ].join(" ");

    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
