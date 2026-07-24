import { describe, expect, it } from "vitest";
import { RobotsTxtRecommender } from "../../../../src/agents/technical-seo-agent/recommendations/robots-txt-recommender.js";
import type { TechnicalSeoRecommendationContext } from "../../../../src/agents/technical-seo-agent/recommendations/technical-seo-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[]): TechnicalSeoRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, crossFunctionalNotes: [] };
}

describe("RobotsTxtRecommender", () => {
  const recommender = new RobotsTxtRecommender();

  it("recommends removing a blocking Disallow rule with high priority", () => {
    const findings: AuditFinding[] = [
      { category: "robots-txt", severity: "critical", message: 'robots.txt contains "Disallow: /page".', recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("high");
    expect(recommendation?.recommendation).toContain("Disallow");
  });

  it("recommends adding a Sitemap reference with low priority for the info-level finding", () => {
    const findings: AuditFinding[] = [
      { category: "robots-txt", severity: "info", message: "No Sitemap: reference was found.", recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("low");
    expect(recommendation?.recommendation).toContain("Sitemap:");
  });

  it("ignores the 'no robots.txt content was supplied' info finding", () => {
    const findings: AuditFinding[] = [
      { category: "robots-txt", severity: "info", message: "No robots.txt content was supplied.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
