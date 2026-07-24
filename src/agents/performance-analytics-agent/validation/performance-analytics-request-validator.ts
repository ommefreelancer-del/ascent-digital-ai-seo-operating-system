// Structural validation and ambiguity detection for an incoming
// PerformanceAnalyticsRequest. Structural problems (empty url, a genuine
// cross-input mismatch) throw immediately, per GLOBAL_RULES.md SS11 "report
// inconsistencies instead of silently correcting them" -- the same
// philosophy SeoStrategyRequestValidator and TechnicalSeoRequestValidator
// apply to their own cross-input checks. A genuinely ambiguous *situation*
// (not an input error) is reported via looksAmbiguous() so the caller can
// escalate to a human per GLOBAL_RULES.md SS13 instead of guessing.

import type { PerformanceAnalyticsRequest } from "../types/performance-analytics-request.types.js";
import type { PerformanceData } from "../types/performance-data-provider.types.js";

export class PerformanceAnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceAnalyticsValidationError";
  }
}

export class PerformanceAnalyticsRequestValidator {
  /** Throws PerformanceAnalyticsValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: PerformanceAnalyticsRequest): void {
    if (!request.url.trim()) {
      throw new PerformanceAnalyticsValidationError("url must not be empty.");
    }

    const knownUrls = [request.websiteAudit.url, request.technicalSeo.url].filter(
      (url): url is string => url !== null && url !== undefined,
    );
    const mismatched = knownUrls.some((url) => url !== request.url);
    if (mismatched) {
      throw new PerformanceAnalyticsValidationError(
        `websiteAudit and technicalSeo appear to describe a different page than the requested url ` +
          `"${request.url}": ${knownUrls.join(", ")}.`,
      );
    }
  }

  /**
   * True when real performance data shows the page actively ranking (a real
   * search-results position) while the website audit independently flags a
   * critical noindex directive for the same page. A noindex'd page ranking
   * is a genuine contradiction -- it could mean the noindex is new (rankings
   * will soon drop) or the ranking data is stale -- so this is escalated
   * rather than silently drawing conclusions from one signal or the other.
   */
  looksAmbiguous(request: PerformanceAnalyticsRequest, performanceData: PerformanceData | null): boolean {
    if (!performanceData) {
      return false;
    }
    const isRanking = performanceData.rankings.some((ranking) => ranking.position !== null);
    if (!isRanking) {
      return false;
    }
    return request.websiteAudit.findings.some(
      (finding) =>
        finding.category === "crawlability" &&
        finding.severity === "critical" &&
        finding.message.toLowerCase().includes("noindex"),
    );
  }
}
