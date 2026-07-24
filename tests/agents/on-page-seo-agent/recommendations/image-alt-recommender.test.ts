import { describe, expect, it } from "vitest";
import { ImageAltRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/image-alt-recommender.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[]): OnPageRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, targetKeyword: "plumber near me", intent: "informational" };
}

describe("ImageAltRecommender", () => {
  const recommender = new ImageAltRecommender();

  it("produces no recommendation when image-alt was not flagged", () => {
    expect(recommender.recommend(makeContext([]))).toEqual([]);
  });

  it("recommends adding alt text and warns against stuffing when flagged", () => {
    const findings: AuditFinding[] = [
      { category: "image-alt", severity: "warning", message: "1 of 2 image(s) are missing an alt attribute entirely.", recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.recommendation).toContain("keyword stuffing");
  });

  it("does not recommend anything for an image-alt finding that isn't about missing alt", () => {
    const findings: AuditFinding[] = [
      { category: "image-alt", severity: "info", message: "No <img> tags were found on this page.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
