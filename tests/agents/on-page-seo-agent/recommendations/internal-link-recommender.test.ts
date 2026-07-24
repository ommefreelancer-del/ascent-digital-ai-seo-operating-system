import { describe, expect, it } from "vitest";
import { OnPageInternalLinkRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/internal-link-recommender.js";
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

describe("OnPageInternalLinkRecommender", () => {
  const recommender = new OnPageInternalLinkRecommender();

  it("produces no recommendation when internal links were not flagged", () => {
    expect(recommender.recommend(makeContext([]))).toEqual([]);
  });

  it("recommends linking practice tied to the target keyword when flagged", () => {
    const findings: AuditFinding[] = [
      { category: "internal-links", severity: "warning", message: "No internal links were found.", recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.recommendation).toContain("plumber near me");
  });
});
