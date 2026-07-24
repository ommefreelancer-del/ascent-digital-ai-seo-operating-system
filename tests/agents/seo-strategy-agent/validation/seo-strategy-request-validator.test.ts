import { describe, expect, it } from "vitest";
import {
  SeoStrategyRequestValidator,
  SeoStrategyValidationError,
} from "../../../../src/agents/seo-strategy-agent/validation/seo-strategy-request-validator.js";
import type { SeoStrategyRequest } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { OnPageSeoResult } from "../../../../src/agents/on-page-seo-agent/types/on-page-seo-request.types.js";

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
  return {
    requestId: "ts-1",
    url,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeOnPageSeo(url: string | null): OnPageSeoResult {
  return {
    requestId: "op-1",
    url,
    targetKeyword: "plumber",
    recommendations: [],
    crossFunctionalNotes: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorIntelligence(competitorGapAnalysis: CompetitorIntelligenceResult["competitorGapAnalysis"]): CompetitorIntelligenceResult {
  return {
    requestId: "ci-1",
    competitorGapAnalysis,
    technicalComparison: [],
    contentGapAnalysis: [],
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<SeoStrategyRequest> = {}): SeoStrategyRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for local plumbing services.",
    keywordResearch: makeKeywordResearch(),
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    technicalSeo: makeTechnicalSeo("https://oursite.com/plumbing"),
    competitorIntelligence: makeCompetitorIntelligence([
      { competitorId: "competitor-a", competitorUrl: null, ourTotalIssues: 1, competitorTotalIssues: 0, assessment: "we_are_behind" },
    ]),
    ...overrides,
  };
}

describe("SeoStrategyRequestValidator", () => {
  const validator = new SeoStrategyRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when businessObjective is empty", () => {
    expect(() => validator.validate(makeRequest({ businessObjective: "   " }))).toThrow(SeoStrategyValidationError);
  });

  it("throws when websiteAudit and technicalSeo describe different pages", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
          technicalSeo: makeTechnicalSeo("https://oursite.com/electrical"),
        }),
      ),
    ).toThrow(/appear to describe different pages/);
  });

  it("throws when onPageSeo describes a different page than websiteAudit", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          onPageSeo: makeOnPageSeo("https://oursite.com/electrical"),
        }),
      ),
    ).toThrow(/appear to describe different pages/);
  });

  it("tolerates null urls when checking cross-input consistency", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          websiteAudit: makeWebsiteAudit(null),
          technicalSeo: makeTechnicalSeo(null),
        }),
      ),
    ).not.toThrow();
  });

  it("looksLowConfidence is true when competitor intelligence analyzed zero competitors", () => {
    const request = makeRequest({ competitorIntelligence: makeCompetitorIntelligence([]) });
    expect(validator.looksLowConfidence(request)).toBe(true);
  });

  it("looksLowConfidence is false when at least one competitor was analyzed", () => {
    expect(validator.looksLowConfidence(makeRequest())).toBe(false);
  });
});
