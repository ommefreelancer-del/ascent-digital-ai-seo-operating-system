// Structural validation and Google-policy risk detection for an incoming
// OnPageSeoRequest. Mirrors the validators in the other agents: structural
// problems throw immediately (caller error); policy-risk signals are
// returned (not thrown) so the caller can escalate to a human per
// GLOBAL_RULES.md SS6/SS13 before proceeding.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { OnPageSeoRequest } from "../types/on-page-seo-request.types.js";

export class OnPageSeoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnPageSeoValidationError";
  }
}

/**
 * Terms associated with manipulative or search-engine-policy-violating
 * on-page practices -- directly reflecting this agent's own rules ("Never
 * use manipulative or keyword-stuffing tactics", "Avoid duplicate or thin
 * content").
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /keyword\s*stuff/i, label: "keyword stuffing" },
  { pattern: /duplicate\s*content/i, label: "duplicate content" },
  { pattern: /thin\s*content/i, label: "thin content" },
  { pattern: /cloak(ing)?/i, label: "cloaking" },
  { pattern: /hidden\s*text/i, label: "hidden text" },
  { pattern: /doorway\s*page/i, label: "doorway pages" },
  { pattern: /auto[\s-]*generated\s*content/i, label: "auto-generated content" },
];

export class OnPageSeoRequestValidator {
  /** Throws OnPageSeoValidationError if the request is structurally invalid. */
  validate(request: OnPageSeoRequest): void {
    const targetKeyword = request.targetKeyword.trim();
    if (!targetKeyword) {
      throw new OnPageSeoValidationError("targetKeyword must not be empty.");
    }

    const normalizedTarget = targetKeyword.toLowerCase();
    const matches = request.keywordResearch.classifiedKeywords.some(
      (classified) => classified.keyword.trim().toLowerCase() === normalizedTarget,
    );
    if (!matches) {
      throw new OnPageSeoValidationError(
        `targetKeyword "${request.targetKeyword}" was not found among keywordResearch.classifiedKeywords.`,
      );
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: OnPageSeoRequest): string[] {
    const haystack = [
      request.targetKeyword,
      ...request.websiteAudit.findings.flatMap((finding) => [finding.message, finding.recommendation]),
    ].join(" ");

    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
