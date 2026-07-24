import { describe, expect, it } from "vitest";
import {
  SeoContentRequestValidator,
  SeoContentValidationError,
} from "../../../../src/agents/seo-content-agent/validation/seo-content-request-validator.js";
import type { SeoContentRequest } from "../../../../src/agents/seo-content-agent/types/seo-content-request.types.js";
import type { ContentBrief, ContentStrategyResult } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: ["24/7 plumber"],
    recommendedSections: ["Introduction", "Frequently Asked Questions", "Conclusion"],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: [],
    ...overrides,
  };
}

function makeContentStrategy(contentBriefs: ContentBrief[] = [makeBrief()]): ContentStrategyResult {
  return {
    requestId: "cs-1",
    topicClusters: [],
    pillarPageStrategy: [],
    internalLinkingRecommendations: [],
    editorialCalendar: [],
    contentGaps: [],
    contentBriefs,
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

function makeRequest(overrides: Partial<SeoContentRequest> = {}): SeoContentRequest {
  return {
    id: "req-1",
    businessObjective: "Grow emergency plumbing leads.",
    contentStrategy: makeContentStrategy(),
    keywordResearch: makeKeywordResearch(),
    ...overrides,
  };
}

describe("SeoContentRequestValidator", () => {
  const validator = new SeoContentRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when businessObjective is empty", () => {
    expect(() => validator.validate(makeRequest({ businessObjective: "   " }))).toThrow(SeoContentValidationError);
  });

  it("throws when contentStrategy has no content briefs", () => {
    expect(() => validator.validate(makeRequest({ contentStrategy: makeContentStrategy([]) }))).toThrow(
      /must contain at least one brief/,
    );
  });

  it("findPolicyRiskSignals returns empty for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("findPolicyRiskSignals detects a risky term in businessObjective", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ businessObjective: "Use keyword stuffing to rank faster." }),
    );
    expect(signals).toContain("keyword stuffing");
  });

  it("findPolicyRiskSignals detects a risky term in brandGuidelines", () => {
    const signals = validator.findPolicyRiskSignals(makeRequest({ brandGuidelines: "It's fine to plagiarize a bit." }));
    expect(signals).toContain("plagiarism");
  });

  it("findPolicyRiskSignals detects a risky term in a content brief title", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ contentStrategy: makeContentStrategy([makeBrief({ title: "Best doorway page tactics" })]) }),
    );
    expect(signals).toContain("doorway pages");
  });

  it("findPolicyRiskSignals never returns duplicate labels", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ businessObjective: "keyword stuffing keyword stuffing keyword stuffing" }),
    );
    expect(signals).toEqual(["keyword stuffing"]);
  });
});
