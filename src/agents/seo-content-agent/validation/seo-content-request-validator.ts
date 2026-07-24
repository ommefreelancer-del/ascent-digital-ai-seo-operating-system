// Structural validation and Google-policy risk detection for an incoming
// SeoContentRequest. Mirrors the validators in the other agents: structural
// problems throw immediately (caller error); policy-risk signals are
// returned (not thrown) so the caller can escalate to a human per
// GLOBAL_RULES.md SS6/SS13 before drafting content for a risky topic.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { SeoContentRequest } from "../types/seo-content-request.types.js";

export class SeoContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoContentValidationError";
  }
}

/**
 * Terms associated with manipulative or search-engine-policy-violating
 * content practices -- directly reflecting this agent's own rules ("Create
 * original content only", "Never plagiarize or copy competitor content",
 * "Follow EEAT and search engine guidelines").
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /plagiar/i, label: "plagiarism" },
  { pattern: /copy\s*(from\s*)?competitor/i, label: "copying competitor content" },
  { pattern: /keyword\s*stuff/i, label: "keyword stuffing" },
  { pattern: /duplicate\s*content/i, label: "duplicate content" },
  { pattern: /thin\s*content/i, label: "thin content" },
  { pattern: /cloak(ing)?/i, label: "cloaking" },
  { pattern: /hidden\s*text/i, label: "hidden text" },
  { pattern: /doorway\s*page/i, label: "doorway pages" },
  { pattern: /auto[\s-]*generated\s*content/i, label: "auto-generated content" },
  { pattern: /fake\s*(review|testimonial)/i, label: "fake reviews or testimonials" },
];

export class SeoContentRequestValidator {
  /** Throws SeoContentValidationError if the request is structurally invalid. */
  validate(request: SeoContentRequest): void {
    if (!request.businessObjective.trim()) {
      throw new SeoContentValidationError("businessObjective must not be empty.");
    }
    if (request.contentStrategy.contentBriefs.length === 0) {
      throw new SeoContentValidationError(
        "contentStrategy.contentBriefs must contain at least one brief to draft content from.",
      );
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: SeoContentRequest): string[] {
    const haystack = [
      request.businessObjective,
      request.brandGuidelines ?? "",
      ...request.contentStrategy.contentBriefs.map((brief) => brief.title),
    ].join(" ");

    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
