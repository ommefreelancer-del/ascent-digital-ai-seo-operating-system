import { describe, expect, it } from "vitest";
import { HttpsRecommender } from "../../../../src/agents/technical-seo-agent/recommendations/https-recommender.js";
import type { TechnicalSeoRecommendationContext } from "../../../../src/agents/technical-seo-agent/recommendations/technical-seo-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[]): TechnicalSeoRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "http://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, crossFunctionalNotes: [] };
}

describe("HttpsRecommender", () => {
  const recommender = new HttpsRecommender();

  it("recommends a migration checklist when the audit flagged http://", () => {
    const findings: AuditFinding[] = [
      { category: "technical-seo", severity: "critical", message: 'The audited URL uses "http://" rather than "https://".', recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("high");
    expect(recommendation?.recommendation).toContain("301 redirect");
    expect(recommendation?.recommendation).toContain("canonical");
  });

  it("produces no recommendation when the audit reports HTTPS is already in use", () => {
    const findings: AuditFinding[] = [
      { category: "technical-seo", severity: "info", message: "The audited URL uses HTTPS.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });

  it("produces no recommendation when no URL was supplied to check", () => {
    const findings: AuditFinding[] = [
      { category: "technical-seo", severity: "info", message: "No URL was supplied; HTTPS could not be checked.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
