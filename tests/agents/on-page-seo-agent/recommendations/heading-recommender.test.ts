import { describe, expect, it } from "vitest";
import { HeadingRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/heading-recommender.js";
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

describe("HeadingRecommender", () => {
  const recommender = new HeadingRecommender();

  it("produces no recommendation when headings were not flagged", () => {
    expect(recommender.recommend(makeContext([]))).toEqual([]);
  });

  it("recommends a fix with high priority for a critical heading finding", () => {
    const findings: AuditFinding[] = [
      { category: "headings", severity: "critical", message: "No <h1> heading was found.", recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("high");
    expect(recommendation?.recommendation).toContain("Plumber Near Me");
  });

  it("produces one recommendation per heading finding", () => {
    const findings: AuditFinding[] = [
      { category: "headings", severity: "warning", message: "2 <h1> headings were found.", recommendation: "x" },
      { category: "headings", severity: "warning", message: "Heading level jumps.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toHaveLength(2);
  });
});
