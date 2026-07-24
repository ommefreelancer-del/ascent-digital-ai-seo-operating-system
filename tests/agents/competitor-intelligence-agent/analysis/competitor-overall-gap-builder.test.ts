import { describe, expect, it } from "vitest";
import { CompetitorOverallGapBuilder } from "../../../../src/agents/competitor-intelligence-agent/analysis/competitor-overall-gap-builder.js";
import type { AuditedCompetitor } from "../../../../src/agents/competitor-intelligence-agent/analysis/audited-competitor.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeAudit(critical: number, warning: number, url: string | null = "https://competitor.com"): WebsiteAuditResult {
  return {
    requestId: "wa-x",
    url,
    findings: [],
    summary: { criticalCount: critical, warningCount: warning, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("CompetitorOverallGapBuilder", () => {
  const builder = new CompetitorOverallGapBuilder();

  it("assesses we_are_behind when the competitor has fewer total issues", () => {
    const ourAudit = makeAudit(3, 2); // 5 total
    const competitors: AuditedCompetitor[] = [{ id: "a", url: "https://a.com", audit: makeAudit(1, 0) }]; // 1 total

    const [gap] = builder.build(ourAudit, competitors);
    expect(gap?.assessment).toBe("we_are_behind");
    expect(gap?.ourTotalIssues).toBe(5);
    expect(gap?.competitorTotalIssues).toBe(1);
  });

  it("assesses we_are_ahead when the competitor has more total issues", () => {
    const ourAudit = makeAudit(0, 1); // 1 total
    const competitors: AuditedCompetitor[] = [{ id: "a", url: null, audit: makeAudit(2, 2) }]; // 4 total

    const [gap] = builder.build(ourAudit, competitors);
    expect(gap?.assessment).toBe("we_are_ahead");
  });

  it("assesses comparable when totals are equal", () => {
    const ourAudit = makeAudit(1, 1); // 2 total
    const competitors: AuditedCompetitor[] = [{ id: "a", url: null, audit: makeAudit(2, 0) }]; // 2 total

    const [gap] = builder.build(ourAudit, competitors);
    expect(gap?.assessment).toBe("comparable");
  });

  it("produces one entry per competitor", () => {
    const ourAudit = makeAudit(0, 0);
    const competitors: AuditedCompetitor[] = [
      { id: "a", url: null, audit: makeAudit(0, 0) },
      { id: "b", url: null, audit: makeAudit(1, 0) },
    ];

    expect(builder.build(ourAudit, competitors)).toHaveLength(2);
  });
});
