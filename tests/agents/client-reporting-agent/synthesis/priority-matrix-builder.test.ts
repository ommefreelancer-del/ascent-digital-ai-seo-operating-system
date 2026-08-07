import { describe, expect, it } from "vitest";
import { PriorityMatrixBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/priority-matrix-builder.js";
import type { SiteAuditResult } from "../../../../src/agents/website-audit-agent/site-audit-orchestrator.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function finding(category: string, severity: AuditFinding["severity"]): AuditFinding {
  return { category, severity, message: "m", recommendation: "r" };
}

function pageAudit(findings: AuditFinding[]): WebsiteAuditResult {
  return {
    requestId: "r",
    url: "https://example.com/",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
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

describe("PriorityMatrixBuilder", () => {
  const builder = new PriorityMatrixBuilder();

  it("buckets a critical finding into critical, with high impact", () => {
    const matrix = builder.build(siteAudit([finding("headings", "critical")]));
    expect(matrix.critical).toHaveLength(1);
    expect(matrix.critical[0]?.estimatedImpact).toBe("high");
  });

  it("buckets a warning in a high-impact category into high", () => {
    const matrix = builder.build(siteAudit([finding("crawlability", "warning")]));
    expect(matrix.high).toHaveLength(1);
  });

  it("buckets a warning in a non-high-impact category into medium", () => {
    const matrix = builder.build(siteAudit([finding("image-alt", "warning")]));
    expect(matrix.medium).toHaveLength(1);
  });

  it("buckets an info finding into low regardless of category", () => {
    const matrix = builder.build(siteAudit([finding("crawlability", "info")]));
    expect(matrix.low).toHaveLength(1);
  });

  it("assigns low estimated effort to quick-fix categories like metadata", () => {
    const matrix = builder.build(siteAudit([finding("metadata", "warning")]));
    const all = [...matrix.critical, ...matrix.high, ...matrix.medium, ...matrix.low];
    expect(all[0]?.estimatedEffort).toBe("low");
  });

  it("assigns high estimated effort to structural categories like crawlability", () => {
    const matrix = builder.build(siteAudit([finding("crawlability", "warning")]));
    expect(matrix.high[0]?.estimatedEffort).toBe("high");
  });

  it("tags per-page findings with the real page URL and site-wide findings with null", () => {
    const matrix = builder.build(siteAudit([finding("headings", "critical")], [finding("broken-links", "critical")]));
    const perPage = matrix.critical.find((f) => f.category === "headings");
    const siteWide = matrix.critical.find((f) => f.category === "broken-links");
    expect(perPage?.pageUrl).toBe("https://example.com/");
    expect(siteWide?.pageUrl).toBeNull();
  });

  it("skips pages that failed to audit (audit === null) without throwing", () => {
    const result: SiteAuditResult = {
      requestId: "r",
      startUrl: "https://example.com/",
      pagesCrawled: 1,
      pageAudits: [{ url: "https://example.com/broken", status: 404, error: "not found", audit: null }],
      siteFindings: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    expect(() => builder.build(result)).not.toThrow();
    const matrix = builder.build(result);
    expect(matrix.critical).toEqual([]);
    expect(matrix.high).toEqual([]);
    expect(matrix.medium).toEqual([]);
    expect(matrix.low).toEqual([]);
  });
});
