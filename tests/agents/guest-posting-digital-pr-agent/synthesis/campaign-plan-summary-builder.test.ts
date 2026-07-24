import { describe, expect, it } from "vitest";
import { CampaignPlanSummaryBuilder } from "../../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-plan-summary-builder.js";
import type { Prospect } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type { QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachStatusEntry } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { NegotiationStatusEntry } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return { url: "https://a.com", domain: "a.com", title: "A", category: "guest-post", confidence: "high", notes: "x", ...overrides };
}

describe("CampaignPlanSummaryBuilder", () => {
  const builder = new CampaignPlanSummaryBuilder();

  it("returns all-zero counts for no real data", () => {
    expect(builder.build([], [], [], [], [])).toEqual({
      totalProspects: 0,
      approvedCount: 0,
      rejectedCount: 0,
      outreachDraftedCount: 0,
      activeNegotiationCount: 0,
    });
  });

  it("counts real prospects, approvals, and rejections", () => {
    const prospects = [makeProspect({ domain: "a.com" }), makeProspect({ domain: "b.com" })];
    const approved: QualifiedProspect[] = [{ url: "https://a.com", domain: "a.com", title: "A", decision: "approved", notes: "x" }];
    const rejected: QualifiedProspect[] = [{ url: "https://b.com", domain: "b.com", title: "B", decision: "rejected", notes: "x" }];

    const summary = builder.build(prospects, approved, rejected, [], []);
    expect(summary.totalProspects).toBe(2);
    expect(summary.approvedCount).toBe(1);
    expect(summary.rejectedCount).toBe(1);
  });

  it("counts only real drafted outreach entries", () => {
    const outreachStatus: OutreachStatusEntry[] = [
      { domain: "a.com", status: "drafted", notes: "x" },
      { domain: "b.com", status: "skipped-no-verified-contact", notes: "x" },
    ];
    const summary = builder.build([], [], [], outreachStatus, []);
    expect(summary.outreachDraftedCount).toBe(1);
  });

  it("counts negotiations in any active stage but excludes confirmed/rejected outcomes", () => {
    const negotiationStatusReport: NegotiationStatusEntry[] = [
      { domain: "a.com", status: "awaiting-reply", notes: "x" },
      { domain: "b.com", status: "negotiating", notes: "x" },
      { domain: "c.com", status: "agreed-pending-confirmation", notes: "x" },
      { domain: "d.com", status: "agreed-confirmed", notes: "x" },
      { domain: "e.com", status: "rejected-over-budget", notes: "x" },
    ];
    const summary = builder.build([], [], [], [], negotiationStatusReport);
    expect(summary.activeNegotiationCount).toBe(3);
  });
});
