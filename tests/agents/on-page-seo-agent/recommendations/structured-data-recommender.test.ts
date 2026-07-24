import { describe, expect, it } from "vitest";
import { StructuredDataRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/structured-data-recommender.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { SearchIntent } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeContext(findings: AuditFinding[], intent: SearchIntent = "informational"): OnPageRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, targetKeyword: "plumber near me", intent };
}

describe("StructuredDataRecommender", () => {
  const recommender = new StructuredDataRecommender();

  it("recommends adding structured data when the audit flagged it missing", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "info", message: "No structured data (application/ld+json) was found.", recommendation: "x" },
    ];
    const recommendations = recommender.recommend(makeContext(findings, "commercial"));
    expect(recommendations.some((r) => r.recommendation.includes("Schema.org"))).toBe(true);
  });

  it("recommends fixing invalid JSON when the audit flagged it", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "A structured data (application/ld+json) block contains invalid JSON.", recommendation: "x" },
    ];
    const recommendations = recommender.recommend(makeContext(findings, "commercial"));
    expect(recommendations.some((r) => r.recommendation.includes("Fix the JSON syntax"))).toBe(true);
  });

  it("recommends a featured-snippet opportunity for informational intent", () => {
    const recommendations = recommender.recommend(makeContext([], "informational"));
    expect(recommendations.some((r) => r.recommendation.includes("FAQPage"))).toBe(true);
  });

  it("does not recommend a featured-snippet opportunity for transactional intent", () => {
    const recommendations = recommender.recommend(makeContext([], "transactional"));
    expect(recommendations.some((r) => r.recommendation.includes("FAQPage"))).toBe(false);
  });

  it("ignores unrelated page-structure findings (doctype/lang/viewport)", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "No <!DOCTYPE html> declaration was found.", recommendation: "x" },
    ];
    const recommendations = recommender.recommend(makeContext(findings, "transactional"));
    expect(recommendations).toEqual([]);
  });
});
