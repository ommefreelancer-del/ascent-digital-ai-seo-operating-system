import { describe, expect, it } from "vitest";
import {
  ContentStrategyRequestValidator,
  ContentStrategyValidationError,
} from "../../../../src/agents/content-strategy-agent/validation/content-strategy-request-validator.js";
import type { ContentStrategyRequest } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeKeywordResearch(overrides: Partial<KeywordResearchResult> = {}): KeywordResearchResult {
  return {
    requestId: "kw-req-1",
    classifiedKeywords: [
      {
        keyword: "plumber near me",
        intent: "informational",
        intentRationale: "default",
        metrics: null,
      },
    ],
    topicClusters: [{ label: "plumber", keywords: ["plumber near me"] }],
    metricsAvailable: false,
    limitations: [],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ContentStrategyRequest> = {}): ContentStrategyRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for a home services website.",
    keywordResearch: makeKeywordResearch(),
    ...overrides,
  };
}

describe("ContentStrategyRequestValidator.validate", () => {
  const validator = new ContentStrategyRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when businessObjective is empty", () => {
    expect(() => validator.validate(makeRequest({ businessObjective: "   " }))).toThrow(
      ContentStrategyValidationError,
    );
  });

  it("throws when keywordResearch has no classified keywords", () => {
    expect(() =>
      validator.validate(makeRequest({ keywordResearch: makeKeywordResearch({ classifiedKeywords: [] }) })),
    ).toThrow(ContentStrategyValidationError);
  });

  it("throws when calendarStartDate is not a valid date", () => {
    expect(() => validator.validate(makeRequest({ calendarStartDate: "not-a-date" }))).toThrow(
      ContentStrategyValidationError,
    );
  });

  it("accepts a valid calendarStartDate", () => {
    expect(() =>
      validator.validate(makeRequest({ calendarStartDate: "2026-01-01T00:00:00.000Z" })),
    ).not.toThrow();
  });

  it("throws when articlesPerWeek is zero or negative", () => {
    expect(() => validator.validate(makeRequest({ articlesPerWeek: 0 }))).toThrow(
      ContentStrategyValidationError,
    );
    expect(() => validator.validate(makeRequest({ articlesPerWeek: -1 }))).toThrow(
      ContentStrategyValidationError,
    );
  });

  it("accepts a positive articlesPerWeek", () => {
    expect(() => validator.validate(makeRequest({ articlesPerWeek: 3 }))).not.toThrow();
  });
});

describe("ContentStrategyRequestValidator.findPolicyRiskSignals", () => {
  const validator = new ContentStrategyRequestValidator();

  it("returns an empty array for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("flags keyword stuffing language in the business objective", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ businessObjective: "Use keyword stuffing across every page." }),
    );
    expect(signals).toContain("keyword stuffing");
  });

  it("flags policy-risk terms appearing in upstream keywords", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({
        keywordResearch: makeKeywordResearch({
          classifiedKeywords: [
            { keyword: "scraped content technique", intent: "informational", intentRationale: "x", metrics: null },
          ],
        }),
      }),
    );
    expect(signals).toContain("scraped content");
  });
});
