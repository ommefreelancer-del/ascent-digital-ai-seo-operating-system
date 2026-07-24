import { describe, expect, it } from "vitest";
import { CanonicalRecommender } from "../../../../src/agents/on-page-seo-agent/recommendations/canonical-recommender.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[], url: string | null = "https://example.com/page"): OnPageRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url,
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, targetKeyword: "plumber near me", intent: "informational" };
}

const MISSING_CANONICAL: AuditFinding = {
  category: "canonical",
  severity: "warning",
  message: "No canonical <link> tag was found.",
  recommendation: "x",
};

describe("CanonicalRecommender", () => {
  const recommender = new CanonicalRecommender();

  it("produces no recommendation when canonical was not flagged", () => {
    expect(recommender.recommend(makeContext([]))).toEqual([]);
  });

  it("recommends the exact self-referencing canonical tag when the url is known", () => {
    const [recommendation] = recommender.recommend(makeContext([MISSING_CANONICAL]));
    expect(recommendation?.recommendation).toContain('href="https://example.com/page"');
  });

  it("recommends adding a canonical without a url when none is known", () => {
    const [recommendation] = recommender.recommend(makeContext([MISSING_CANONICAL], null));
    expect(recommendation?.recommendation).toContain("once the page's real URL is known");
  });

  it("ignores a canonical finding that isn't about a missing tag", () => {
    const findings: AuditFinding[] = [
      { category: "canonical", severity: "info", message: "Canonical tag points elsewhere.", recommendation: "x" },
    ];
    expect(recommender.recommend(makeContext(findings))).toEqual([]);
  });
});
