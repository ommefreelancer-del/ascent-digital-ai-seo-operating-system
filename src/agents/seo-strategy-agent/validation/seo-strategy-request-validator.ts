// Structural validation and low-confidence detection for an incoming
// SeoStrategyRequest. A genuine cross-input mismatch (the supplied results
// appear to describe different pages) throws immediately, per
// GLOBAL_RULES.md SS11 "report inconsistencies instead of silently
// correcting them" -- the same philosophy TechnicalSeoAgent applies to its
// own cross-functional-notes correlation check.

import type { SeoStrategyRequest } from "../types/seo-strategy-request.types.js";

export class SeoStrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoStrategyValidationError";
  }
}

export class SeoStrategyRequestValidator {
  /** Throws SeoStrategyValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: SeoStrategyRequest): void {
    if (!request.businessObjective.trim()) {
      throw new SeoStrategyValidationError("businessObjective must not be empty.");
    }

    const knownUrls = [request.websiteAudit.url, request.technicalSeo.url, request.onPageSeo?.url].filter(
      (url): url is string => url !== null && url !== undefined,
    );
    const distinctUrls = new Set(knownUrls);
    if (distinctUrls.size > 1) {
      throw new SeoStrategyValidationError(
        `websiteAudit, technicalSeo, and onPageSeo appear to describe different pages: ` +
          `${Array.from(distinctUrls).join(", ")}.`,
      );
    }
  }

  /**
   * True when competitor intelligence produced zero successfully analyzed
   * competitors -- the competitive dimension of the strategy would be
   * entirely empty, a genuinely lower-confidence basis for prioritization.
   */
  looksLowConfidence(request: SeoStrategyRequest): boolean {
    return request.competitorIntelligence.competitorGapAnalysis.length === 0;
  }
}
