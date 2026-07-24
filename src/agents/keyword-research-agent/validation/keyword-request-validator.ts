// Structural validation and Google-policy risk detection for an incoming
// KeywordResearchRequest. Structural problems (empty/duplicate/blank fields)
// are the caller's error and throw immediately, matching the same
// fail-loudly convention as agent-spec-parser.ts's mandatory sections.
// Policy-risk detection does NOT throw -- it returns the matched signals so
// the caller (KeywordResearchAgent) can escalate to a human per
// GLOBAL_RULES.md SS6/SS13 rather than silently refusing or silently
// complying.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { KeywordResearchRequest } from "../types/keyword-request.types.js";

export class KeywordRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeywordRequestValidationError";
  }
}

/**
 * Terms associated with manipulative or search-engine-policy-violating SEO
 * practices (per Google Search Essentials / spam policies). Presence of any
 * of these in a request is a signal the request may ask for something
 * GLOBAL_RULES.md SS6 forbids ("never recommend deceptive or manipulative
 * SEO techniques") -- not proof of intent, which is exactly why it routes to
 * human review instead of an automatic reject.
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /keyword\s*stuff/i, label: "keyword stuffing" },
  { pattern: /cloak(ing)?/i, label: "cloaking" },
  { pattern: /doorway\s*page/i, label: "doorway pages" },
  { pattern: /hidden\s*text/i, label: "hidden text" },
  { pattern: /link\s*farm/i, label: "link farms" },
  { pattern: /\bpbn\b|private\s*blog\s*network/i, label: "private blog networks" },
  { pattern: /buy\s*backlinks?|paid\s*links?/i, label: "paid/purchased links" },
  { pattern: /auto[\s-]*generated\s*content/i, label: "auto-generated content" },
  { pattern: /scraped\s*content/i, label: "scraped content" },
];

export class KeywordRequestValidator {
  /** Throws KeywordRequestValidationError if the request is structurally invalid. */
  validate(request: KeywordResearchRequest): void {
    if (!request.businessObjective.trim()) {
      throw new KeywordRequestValidationError("businessObjective must not be empty.");
    }
    if (request.seedKeywords.length === 0) {
      throw new KeywordRequestValidationError("seedKeywords must contain at least one keyword.");
    }

    const seen = new Set<string>();
    for (const keyword of request.seedKeywords) {
      const trimmed = keyword.trim();
      if (!trimmed) {
        throw new KeywordRequestValidationError("seedKeywords must not contain blank entries.");
      }
      const normalized = trimmed.toLowerCase();
      if (seen.has(normalized)) {
        throw new KeywordRequestValidationError(`Duplicate seed keyword: "${trimmed}".`);
      }
      seen.add(normalized);
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: KeywordResearchRequest): string[] {
    const haystack = [request.businessObjective, ...request.seedKeywords].join(" ");
    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
