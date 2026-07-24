// Structural validation and Google-policy risk detection for an incoming
// ContentStrategyRequest. Mirrors
// src/agents/keyword-research-agent/validation/keyword-request-validator.ts:
// structural problems throw immediately (caller error); policy-risk signals
// are returned (not thrown) so the caller can escalate to a human per
// GLOBAL_RULES.md SS6/SS13 rather than silently complying or refusing.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { ContentStrategyRequest } from "../types/content-strategy-request.types.js";

export class ContentStrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStrategyValidationError";
  }
}

/**
 * Terms associated with manipulative or search-engine-policy-violating
 * content practices (per Google Search Essentials / spam policies) --
 * directly reflecting this agent's own rules ("Avoid keyword stuffing",
 * "Recommend sustainable, search-engine-compliant strategies").
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /keyword\s*stuff/i, label: "keyword stuffing" },
  { pattern: /duplicate\s*content/i, label: "duplicate content" },
  { pattern: /scraped\s*content/i, label: "scraped content" },
  { pattern: /auto[\s-]*generated\s*content/i, label: "auto-generated content" },
  { pattern: /content\s*spinning|spun\s*content/i, label: "content spinning" },
  { pattern: /thin\s*content/i, label: "thin content" },
  { pattern: /cloak(ing)?/i, label: "cloaking" },
  { pattern: /doorway\s*page/i, label: "doorway pages" },
];

export class ContentStrategyRequestValidator {
  /** Throws ContentStrategyValidationError if the request is structurally invalid. */
  validate(request: ContentStrategyRequest): void {
    if (!request.businessObjective.trim()) {
      throw new ContentStrategyValidationError("businessObjective must not be empty.");
    }
    if (!request.keywordResearch || request.keywordResearch.classifiedKeywords.length === 0) {
      throw new ContentStrategyValidationError(
        "keywordResearch must include at least one classified keyword.",
      );
    }
    if (
      request.calendarStartDate !== undefined &&
      Number.isNaN(new Date(request.calendarStartDate).getTime())
    ) {
      throw new ContentStrategyValidationError(
        `Invalid calendarStartDate: "${request.calendarStartDate}".`,
      );
    }
    if (
      request.articlesPerWeek !== undefined &&
      !(Number.isFinite(request.articlesPerWeek) && request.articlesPerWeek > 0)
    ) {
      throw new ContentStrategyValidationError("articlesPerWeek must be a positive number.");
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: ContentStrategyRequest): string[] {
    const haystack = [
      request.businessObjective,
      ...request.keywordResearch.classifiedKeywords.map((k) => k.keyword),
    ].join(" ");

    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
