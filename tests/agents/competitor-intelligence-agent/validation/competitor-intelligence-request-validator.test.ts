import { describe, expect, it } from "vitest";
import {
  CompetitorIntelligenceRequestValidator,
  CompetitorIntelligenceValidationError,
} from "../../../../src/agents/competitor-intelligence-agent/validation/competitor-intelligence-request-validator.js";
import type { CompetitorIntelligenceRequest, CompetitorSnapshot } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeWebsiteAudit(url: string | null = "https://oursite.com/page"): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url,
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com/page",
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

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

function makeCompetitor(overrides: Partial<CompetitorSnapshot> = {}): CompetitorSnapshot {
  return { id: "competitor-a", html: "<html><body><h1>Hi</h1></body></html>", ...overrides };
}

function makeRequest(overrides: Partial<CompetitorIntelligenceRequest> = {}): CompetitorIntelligenceRequest {
  return {
    id: "req-1",
    ourWebsiteAudit: makeWebsiteAudit(),
    ourTechnicalSeo: makeTechnicalSeo(),
    ourKeywordResearch: makeKeywordResearch(),
    competitors: [makeCompetitor(), makeCompetitor({ id: "competitor-b" })],
    ...overrides,
  };
}

describe("CompetitorIntelligenceRequestValidator.validate", () => {
  const validator = new CompetitorIntelligenceRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when competitors is empty", () => {
    expect(() => validator.validate(makeRequest({ competitors: [] }))).toThrow(
      CompetitorIntelligenceValidationError,
    );
  });

  it("throws when a competitor has empty html", () => {
    expect(() =>
      validator.validate(makeRequest({ competitors: [makeCompetitor({ html: "   " })] })),
    ).toThrow(/empty html/);
  });

  it("throws on a duplicate competitor id", () => {
    expect(() =>
      validator.validate(
        makeRequest({ competitors: [makeCompetitor(), makeCompetitor()] }),
      ),
    ).toThrow(/Duplicate competitor id/);
  });

  it("throws on an invalid competitor url", () => {
    expect(() =>
      validator.validate(makeRequest({ competitors: [makeCompetitor({ url: "not a url" })] })),
    ).toThrow(/invalid url/);
  });

  it("throws on a non-http(s) competitor url", () => {
    expect(() =>
      validator.validate(makeRequest({ competitors: [makeCompetitor({ url: "ftp://competitor.com/page" })] })),
    ).toThrow(/http or https/);
  });

  it("throws on a duplicate competitor url", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          competitors: [
            makeCompetitor({ url: "https://competitor.com/page" }),
            makeCompetitor({ id: "competitor-b", url: "https://competitor.com/page" }),
          ],
        }),
      ),
    ).toThrow(/Duplicate competitor url/);
  });

  it("throws when a competitor url host matches our own site's host", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          ourWebsiteAudit: makeWebsiteAudit("https://oursite.com/page"),
          competitors: [makeCompetitor({ url: "https://oursite.com/other-page" })],
        }),
      ),
    ).toThrow(/cannot compare a site against itself/);
  });

  it("does not check for self-comparison when our own url is unknown", () => {
    expect(() =>
      validator.validate(
        makeRequest({
          ourWebsiteAudit: makeWebsiteAudit(null),
          competitors: [makeCompetitor({ url: "https://competitor.com/page" })],
        }),
      ),
    ).not.toThrow();
  });
});

describe("CompetitorIntelligenceRequestValidator.looksLowConfidence", () => {
  const validator = new CompetitorIntelligenceRequestValidator();

  it("is true with exactly one competitor", () => {
    expect(validator.looksLowConfidence(makeRequest({ competitors: [makeCompetitor()] }))).toBe(true);
  });

  it("is false with two or more competitors", () => {
    expect(validator.looksLowConfidence(makeRequest())).toBe(false);
  });
});
