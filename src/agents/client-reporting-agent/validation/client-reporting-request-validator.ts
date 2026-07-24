// Structural validation and low-confidence detection for an incoming
// ClientReportingRequest. A genuine cross-input mismatch (the supplied
// results appear to describe different pages) throws immediately, per
// GLOBAL_RULES.md SS11 "report inconsistencies instead of silently
// correcting them" -- the same philosophy SeoStrategyRequestValidator
// applies to its own cross-input check.

import type { ClientReportingRequest } from "../types/client-reporting-request.types.js";

export class ClientReportingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientReportingValidationError";
  }
}

export class ClientReportingRequestValidator {
  /** Throws ClientReportingValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: ClientReportingRequest): void {
    if (!request.clientName.trim()) {
      throw new ClientReportingValidationError("clientName must not be empty.");
    }
    if (!request.reportingPeriodLabel.trim()) {
      throw new ClientReportingValidationError("reportingPeriodLabel must not be empty.");
    }

    const knownUrls = [request.performanceAnalytics.url, request.websiteAudit.url, request.technicalSeo.url].filter(
      (url): url is string => url !== null && url !== undefined,
    );
    const distinctUrls = new Set(knownUrls);
    if (distinctUrls.size > 1) {
      throw new ClientReportingValidationError(
        `performanceAnalytics, websiteAudit, and technicalSeo appear to describe different pages: ` +
          `${Array.from(distinctUrls).join(", ")}.`,
      );
    }
  }

  /**
   * True when no real, measured performance data (rankings, traffic, Core
   * Web Vitals) is available -- presenting a client report built mostly
   * from structural findings, with no measured performance signal, is a
   * genuinely lower-confidence basis and warrants human review before it
   * reaches a client.
   */
  looksLowConfidence(request: ClientReportingRequest): boolean {
    return !request.performanceAnalytics.dataAvailable;
  }
}
