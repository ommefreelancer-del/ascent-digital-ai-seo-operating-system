import { describe, expect, it } from "vitest";
import {
  ClientReportingRequestValidator,
  ClientReportingValidationError,
} from "../../../../src/agents/client-reporting-agent/validation/client-reporting-request-validator.js";
import type { ClientReportingRequest } from "../../../../src/agents/client-reporting-agent/types/client-reporting-request.types.js";
import type { PerformanceAnalyticsResult } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makePerformanceAnalytics(overrides: Partial<PerformanceAnalyticsResult> = {}): PerformanceAnalyticsResult {
  return {
    requestId: "pa-1",
    url: "https://oursite.com/plumbing",
    dataAvailable: true,
    rankingInsights: [],
    trafficInsight: null,
    coreWebVitalInsights: [],
    lighthouseCategoryScores: null,
    opportunities: [],
    roiInsight: null,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWebsiteAudit(url: string | null): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url,
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(url: string | null): TechnicalSeoResult {
  return { requestId: "ts-1", url, recommendations: [], limitations: [], decidedAt: new Date().toISOString() };
}

function makeRequest(overrides: Partial<ClientReportingRequest> = {}): ClientReportingRequest {
  return {
    id: "req-1",
    clientName: "Acme Plumbing",
    reportingPeriodLabel: "July 2026",
    performanceAnalytics: makePerformanceAnalytics(),
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    technicalSeo: makeTechnicalSeo("https://oursite.com/plumbing"),
    ...overrides,
  };
}

describe("ClientReportingRequestValidator", () => {
  const validator = new ClientReportingRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when clientName is empty", () => {
    expect(() => validator.validate(makeRequest({ clientName: "   " }))).toThrow(ClientReportingValidationError);
  });

  it("throws when reportingPeriodLabel is empty", () => {
    expect(() => validator.validate(makeRequest({ reportingPeriodLabel: "   " }))).toThrow(
      ClientReportingValidationError,
    );
  });

  it("throws when performanceAnalytics and websiteAudit describe different pages", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          performanceAnalytics: makePerformanceAnalytics({ url: "https://oursite.com/electrical" }),
        }),
      ),
    ).toThrow(/appear to describe different pages/);
  });

  it("tolerates null websiteAudit/technicalSeo urls when checking cross-input consistency", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          websiteAudit: makeWebsiteAudit(null),
          technicalSeo: makeTechnicalSeo(null),
        }),
      ),
    ).not.toThrow();
  });

  it("looksLowConfidence is true when no real performance data is available", () => {
    const request = makeRequest({ performanceAnalytics: makePerformanceAnalytics({ dataAvailable: false }) });
    expect(validator.looksLowConfidence(request)).toBe(true);
  });

  it("looksLowConfidence is false when real performance data is available", () => {
    expect(validator.looksLowConfidence(makeRequest())).toBe(false);
  });
});
