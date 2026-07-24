import { describe, expect, it } from "vitest";
import { TitleMetaRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/title-meta-recommender.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { WebsiteAuditResult, AuditFinding } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeAudit(findings: AuditFinding[]): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeContext(findings: AuditFinding[]): OnPageRecommendationContext {
  return { websiteAudit: makeAudit(findings), targetKeyword: "plumber near me", intent: "informational" };
}

describe("TitleMetaRecommender", () => {
  const recommender = new TitleMetaRecommender();

  it("produces no recommendation when metadata was not flagged", () => {
    expect(recommender.recommend(makeContext([]))).toEqual([]);
  });

  it("recommends a title when the audit flagged a title problem", () => {
    const findings: AuditFinding[] = [
      { category: "metadata", severity: "critical", message: 'No <title> tag was found.', recommendation: "Add one." },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.category).toBe("title-tag");
    expect(recommendation?.priority).toBe("high");
    expect(recommendation?.recommendation).toContain("Plumber Near Me");
  });

  it("recommends a meta description when the audit flagged a description problem", () => {
    const findings: AuditFinding[] = [
      { category: "metadata", severity: "warning", message: "No meta description was found.", recommendation: "Add one." },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.category).toBe("meta-description");
    expect(recommendation?.priority).toBe("medium");
  });

  it("produces both recommendations when both are flagged", () => {
    const findings: AuditFinding[] = [
      { category: "metadata", severity: "critical", message: "No <title> tag was found.", recommendation: "x" },
      { category: "metadata", severity: "warning", message: "No meta description was found.", recommendation: "x" },
    ];
    const recommendations = recommender.recommend(makeContext(findings));
    expect(recommendations.map((r) => r.category).sort()).toEqual(["meta-description", "title-tag"]);
  });

  it("ignores findings from other categories", () => {
    const findings: AuditFinding[] = [
      { category: "headings", severity: "critical", message: "No <h1> heading was found.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
