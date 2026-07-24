import { describe, expect, it } from "vitest";
import { CrawlabilityRecommender } from "../../../../src/agents/technical-seo-agent/recommendations/crawlability-recommender.js";
import type { TechnicalSeoRecommendationContext } from "../../../../src/agents/technical-seo-agent/recommendations/technical-seo-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[], notes: string[] = []): TechnicalSeoRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, crossFunctionalNotes: notes };
}

describe("CrawlabilityRecommender", () => {
  const recommender = new CrawlabilityRecommender();

  it("recommends removing noindex with high priority for a critical finding", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "critical", message: 'noindex found (content="noindex").', recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("high");
    expect(recommendation?.recommendation).toContain("Remove the noindex directive");
  });

  it("recommends reviewing nofollow for a warning finding", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "warning", message: "nofollow found.", recommendation: "x" },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.priority).toBe("medium");
    expect(recommendation?.recommendation).toContain("nofollow");
  });

  it("ignores the info-level 'no meta robots tag, no action required' case", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "info", message: 'No <meta name="robots"> tag was found.', recommendation: "No action required." },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });

  it("marks confirmedByCrossFunctionalNote true when a note repeats the finding's message", () => {
    const finding: AuditFinding = { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" };
    const note = `[crawlability, critical] noindex found. (outside On-Page SEO Agent's scope -- coordinate with the Technical SEO Agent.)`;
    const [recommendation] = recommender.recommend(makeContext([finding], [note]));
    expect(recommendation?.confirmedByCrossFunctionalNote).toBe(true);
  });

  it("marks confirmedByCrossFunctionalNote false with no matching note", () => {
    const finding: AuditFinding = { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" };
    const [recommendation] = recommender.recommend(makeContext([finding], []));
    expect(recommendation?.confirmedByCrossFunctionalNote).toBe(false);
  });
});
