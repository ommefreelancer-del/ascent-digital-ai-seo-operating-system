import { describe, expect, it } from "vitest";
import { PageStructureRecommender } from "../../../../src/agents/technical-seo-agent/recommendations/page-structure-recommender.js";
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

describe("PageStructureRecommender", () => {
  const recommender = new PageStructureRecommender();

  it("recommends fixing a missing doctype, passing through the audit's own recommendation", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "No <!DOCTYPE html> declaration was found.", recommendation: "Add a standard HTML5 doctype declaration." },
    ];
    const [recommendation] = recommender.recommend(makeContext(findings));
    expect(recommendation?.recommendation).toBe("Add a standard HTML5 doctype declaration.");
    expect(recommendation?.priority).toBe("medium");
  });

  it("recommends fixing a missing lang attribute and missing viewport meta", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "The <html> tag has no lang attribute.", recommendation: "Add a lang attribute." },
      { category: "page-structure", severity: "warning", message: "No viewport meta tag was found.", recommendation: "Add a viewport meta tag." },
    ];
    expect(recommender.recommend(makeContext(findings))).toHaveLength(2);
  });

  it("excludes structured-data page-structure findings (owned by the On-Page SEO Agent)", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "info", message: "No structured data (application/ld+json) was found.", recommendation: "x" },
      { category: "page-structure", severity: "warning", message: "A structured data (application/ld+json) block contains invalid JSON.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });

  it("ignores findings from other categories", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
