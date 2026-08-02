import { describe, expect, it } from "vitest";
import { ScoreCardBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/score-card-builder.js";
import type { SiteAuditResult } from "../../../../src/agents/website-audit-agent/site-audit-orchestrator.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { PerformanceAnalyticsResult } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";

function finding(category: string, severity: AuditFinding["severity"]): AuditFinding {
  return { category, severity, message: "m", recommendation: "r" };
}

function pageAudit(findings: AuditFinding[]): WebsiteAuditResult {
  return {
    requestId: "r",
    url: "https://example.com/",
    findings,
    summary: {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function siteAudit(findings: AuditFinding[], siteFindings: AuditFinding[] = []): SiteAuditResult {
  return {
    requestId: "r",
    startUrl: "https://example.com/",
    pagesCrawled: 1,
    pageAudits: [{ url: "https://example.com/", status: 200, error: null, audit: pageAudit(findings) }],
    siteFindings,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

const NO_PERFORMANCE: PerformanceAnalyticsResult | null = null;

describe("ScoreCardBuilder", () => {
  const builder = new ScoreCardBuilder();

  it("scores 100 across all categories when there are no findings", () => {
    const card = builder.build(siteAudit([]), NO_PERFORMANCE);
    expect(card.technicalSeoScore).toBe(100);
    expect(card.contentScore).toBe(100);
    expect(card.accessibilityScore).toBe(100);
    expect(card.uxScore).toBe(100);
    expect(card.securityScore).toBe(100);
    expect(card.aiSeoReadinessScore).toBe(100);
    expect(card.overallSeoScore).toBe(100);
  });

  it("deducts more for a critical finding than a warning in the same category", () => {
    const critical = builder.build(siteAudit([finding("crawlability", "critical")]), NO_PERFORMANCE);
    const warning = builder.build(siteAudit([finding("crawlability", "warning")]), NO_PERFORMANCE);
    expect(critical.technicalSeoScore).toBeLessThan(warning.technicalSeoScore as number);
  });

  it("never scores below 0 even with many critical findings", () => {
    const many = Array.from({ length: 20 }, () => finding("crawlability", "critical"));
    const card = builder.build(siteAudit(many), NO_PERFORMANCE);
    expect(card.technicalSeoScore).toBe(0);
  });

  it("scores the security category from technical-seo findings distinctly from technicalSeoScore's own categories", () => {
    const card = builder.build(siteAudit([finding("technical-seo", "critical")]), NO_PERFORMANCE);
    expect(card.securityScore).toBeLessThan(100);
    expect(card.technicalSeoScore).toBe(100); // "technical-seo" category is not in TECHNICAL_CATEGORIES
  });

  it("returns performanceScore null and reports a limitation when no performance data is available", () => {
    const card = builder.build(siteAudit([]), NO_PERFORMANCE);
    expect(card.performanceScore).toBeNull();
    expect(card.limitations.some((l) => l.includes("Performance Score is null"))).toBe(true);
  });

  it("computes a real performanceScore from Core Web Vitals pass rate when available", () => {
    const performanceAnalytics: PerformanceAnalyticsResult = {
      requestId: "pa",
      url: "https://example.com/",
      dataAvailable: true,
      rankingInsights: [],
      trafficInsight: null,
      coreWebVitalInsights: [
        { metric: "LCP", value: 2000, threshold: 2500, passesThreshold: true },
        { metric: "CLS", value: 0.2, threshold: 0.1, passesThreshold: false },
      ],
      lighthouseCategoryScores: null,
      opportunities: [],
      roiInsight: null,
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const card = builder.build(siteAudit([]), performanceAnalytics);
    expect(card.performanceScore).toBe(50);
  });

  it("computes overallSeoScore as the average of the available numeric category scores", () => {
    const card = builder.build(siteAudit([]), NO_PERFORMANCE);
    // All 6 non-performance categories are 100, performance is null -> average of six 100s = 100.
    expect(card.overallSeoScore).toBe(100);
  });

  it("includes site-wide findings (not just per-page) in the technical score", () => {
    const card = builder.build(siteAudit([], [finding("broken-links", "critical")]), NO_PERFORMANCE);
    expect(card.technicalSeoScore).toBeLessThan(100);
  });
});
