import { describe, expect, it } from "vitest";
import { TechnicalComparisonBuilder } from "../../../../src/agents/competitor-intelligence-agent/analysis/technical-comparison-builder.js";
import type { AuditedCompetitor } from "../../../../src/agents/competitor-intelligence-agent/analysis/audited-competitor.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { WebsiteAuditResult, AuditFinding } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeOurTechnicalSeo(recommendationCategories: string[]): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com",
    recommendations: recommendationCategories.map((category) => ({
      category,
      priority: "high",
      recommendation: "x",
      rationale: "x",
      confirmedByCrossFunctionalNote: false,
    })),
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorAudit(findings: AuditFinding[]): AuditedCompetitor {
  const audit: WebsiteAuditResult = {
    requestId: "wa-x",
    url: "https://competitor.com",
    findings,
    summary: {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { id: "competitor-a", url: "https://competitor.com", audit };
}

describe("TechnicalComparisonBuilder", () => {
  const builder = new TechnicalComparisonBuilder();

  it("gives the competitor advantage when they have fewer issues in a category", () => {
    const ourTechnicalSeo = makeOurTechnicalSeo(["https"]);
    const competitor = makeCompetitorAudit([]); // no technical-seo findings at all

    const [comparison] = builder.build(ourTechnicalSeo, [competitor]);
    const httpsEntry = comparison?.categories.find((c) => c.category === "https");
    expect(httpsEntry?.ourIssueCount).toBe(1);
    expect(httpsEntry?.competitorIssueCount).toBe(0);
    expect(httpsEntry?.advantage).toBe("competitor");
  });

  it("gives us the advantage when the competitor has more issues in a category", () => {
    const ourTechnicalSeo = makeOurTechnicalSeo([]);
    const competitor = makeCompetitorAudit([
      { category: "technical-seo", severity: "critical", message: "http", recommendation: "x" },
    ]);

    const [comparison] = builder.build(ourTechnicalSeo, [competitor]);
    const httpsEntry = comparison?.categories.find((c) => c.category === "https");
    expect(httpsEntry?.advantage).toBe("us");
  });

  it("maps the 'https' category to the audit's 'technical-seo' finding category", () => {
    const ourTechnicalSeo = makeOurTechnicalSeo([]);
    const competitor = makeCompetitorAudit([
      { category: "technical-seo", severity: "critical", message: "http", recommendation: "x" },
      { category: "crawlability", severity: "critical", message: "noindex", recommendation: "x" },
    ]);

    const [comparison] = builder.build(ourTechnicalSeo, [competitor]);
    expect(comparison?.categories.find((c) => c.category === "https")?.competitorIssueCount).toBe(1);
    expect(comparison?.categories.find((c) => c.category === "crawlability")?.competitorIssueCount).toBe(1);
  });

  it("ignores info-severity competitor findings", () => {
    const ourTechnicalSeo = makeOurTechnicalSeo([]);
    const competitor = makeCompetitorAudit([
      { category: "robots-txt", severity: "info", message: "No Sitemap.", recommendation: "x" },
    ]);

    const [comparison] = builder.build(ourTechnicalSeo, [competitor]);
    expect(comparison?.categories.find((c) => c.category === "robots-txt")?.competitorIssueCount).toBe(0);
  });

  it("produces exactly the 4 technical categories per competitor", () => {
    const [comparison] = builder.build(makeOurTechnicalSeo([]), [makeCompetitorAudit([])]);
    expect(comparison?.categories.map((c) => c.category).sort()).toEqual(
      ["crawlability", "https", "page-structure", "robots-txt"].sort(),
    );
  });
});
