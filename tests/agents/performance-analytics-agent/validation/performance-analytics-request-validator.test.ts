import { describe, expect, it } from "vitest";
import {
  PerformanceAnalyticsRequestValidator,
  PerformanceAnalyticsValidationError,
} from "../../../../src/agents/performance-analytics-agent/validation/performance-analytics-request-validator.js";
import type { PerformanceAnalyticsRequest } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { PerformanceData } from "../../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [],
    topicClusters: [],
    metricsAvailable: false,
    limitations: [],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

function makeWebsiteAudit(url: string | null, findings: WebsiteAuditResult["findings"] = []): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url,
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(url: string | null): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<PerformanceAnalyticsRequest> = {}): PerformanceAnalyticsRequest {
  return {
    id: "req-1",
    url: "https://oursite.com/plumbing",
    keywordResearch: makeKeywordResearch(),
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    technicalSeo: makeTechnicalSeo("https://oursite.com/plumbing"),
    ...overrides,
  };
}

function makePerformanceData(overrides: Partial<PerformanceData> = {}): PerformanceData {
  return {
    url: "https://oursite.com/plumbing",
    rankings: [],
    traffic: null,
    coreWebVitals: null,
    categoryScores: null,
    source: "test-provider",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PerformanceAnalyticsRequestValidator", () => {
  const validator = new PerformanceAnalyticsRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when url is empty", () => {
    expect(() => validator.validate(makeRequest({ url: "   " }))).toThrow(PerformanceAnalyticsValidationError);
  });

  it("throws when websiteAudit describes a different page than the requested url", () => {
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit("https://oursite.com/electrical") })),
    ).toThrow(/appear to describe a different page/);
  });

  it("throws when technicalSeo describes a different page than the requested url", () => {
    expect(() =>
      validator.validate(makeRequest({ technicalSeo: makeTechnicalSeo("https://oursite.com/electrical") })),
    ).toThrow(/appear to describe a different page/);
  });

  it("tolerates a null websiteAudit/technicalSeo url", () => {
    expect(() =>
      validator.validate(
        makeRequest({ websiteAudit: makeWebsiteAudit(null), technicalSeo: makeTechnicalSeo(null) }),
      ),
    ).not.toThrow();
  });

  it("looksAmbiguous is false when there is no performance data", () => {
    expect(validator.looksAmbiguous(makeRequest(), null)).toBe(false);
  });

  it("looksAmbiguous is false when the page ranks but there is no noindex finding", () => {
    const performanceData = makePerformanceData({
      rankings: [{ keyword: "plumber", position: 5, previousPosition: 6, impressions: 100, clicks: 10, ctr: 0.1 }],
    });
    expect(validator.looksAmbiguous(makeRequest(), performanceData)).toBe(false);
  });

  it("looksAmbiguous is false when there is a noindex finding but the page does not rank", () => {
    const request = makeRequest({
      websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing", [
        { category: "crawlability", severity: "critical", message: 'A noindex tag was found.', recommendation: "x" },
      ]),
    });
    const performanceData = makePerformanceData({
      rankings: [{ keyword: "plumber", position: null, previousPosition: null, impressions: null, clicks: null, ctr: null }],
    });
    expect(validator.looksAmbiguous(request, performanceData)).toBe(false);
  });

  it("looksAmbiguous is true when the page ranks while also critically flagged noindex", () => {
    const request = makeRequest({
      websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing", [
        { category: "crawlability", severity: "critical", message: 'A noindex tag was found.', recommendation: "x" },
      ]),
    });
    const performanceData = makePerformanceData({
      rankings: [{ keyword: "plumber", position: 5, previousPosition: 6, impressions: 100, clicks: 10, ctr: 0.1 }],
    });
    expect(validator.looksAmbiguous(request, performanceData)).toBe(true);
  });
});
