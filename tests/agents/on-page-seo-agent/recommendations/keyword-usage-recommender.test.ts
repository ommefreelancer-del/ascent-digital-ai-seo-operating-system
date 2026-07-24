import { describe, expect, it } from "vitest";
import { KeywordUsageRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/keyword-usage-recommender.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(url: string | null, targetKeyword: string): OnPageRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url,
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, targetKeyword, intent: "informational" };
}

describe("KeywordUsageRecommender", () => {
  const recommender = new KeywordUsageRecommender();

  it("always includes a keyword-placement recommendation", () => {
    const recommendations = recommender.recommend(makeContext(null, "plumber near me"));
    expect(recommendations.some((r) => r.category === "keyword-placement")).toBe(true);
  });

  it("recommends a URL change when the keyword is not present in the URL path", () => {
    const recommendations = recommender.recommend(makeContext("https://example.com/services", "plumber near me"));
    expect(recommendations.some((r) => r.category === "url-structure")).toBe(true);
  });

  it("does not recommend a URL change when the keyword is already present in the URL path", () => {
    const recommendations = recommender.recommend(
      makeContext("https://example.com/plumber-near-me", "plumber near me"),
    );
    expect(recommendations.some((r) => r.category === "url-structure")).toBe(false);
  });

  it("does not attempt a URL recommendation when no URL is known", () => {
    const recommendations = recommender.recommend(makeContext(null, "plumber near me"));
    expect(recommendations.some((r) => r.category === "url-structure")).toBe(false);
  });

  it("mentions a 301 redirect caution in the URL recommendation", () => {
    const recommendations = recommender.recommend(makeContext("https://example.com/services", "plumber near me"));
    const urlRecommendation = recommendations.find((r) => r.category === "url-structure");
    expect(urlRecommendation?.recommendation).toContain("301 redirect");
  });
});
