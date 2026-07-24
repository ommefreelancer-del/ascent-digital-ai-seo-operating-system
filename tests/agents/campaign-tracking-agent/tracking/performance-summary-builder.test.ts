import { describe, expect, it } from "vitest";
import { PerformanceSummaryBuilder } from "../../../../src/agents/campaign-tracking-agent/tracking/performance-summary-builder.js";
import type { CampaignStatusSummary } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

function makeStatus(overrides: Partial<CampaignStatusSummary> = {}): CampaignStatusSummary {
  return { phase: "in-progress", totalApprovedPublishers: 4, draftedCount: 3, skippedCount: 1, ...overrides };
}

describe("PerformanceSummaryBuilder", () => {
  const builder = new PerformanceSummaryBuilder();

  it("computes a real draft rate from real counts", () => {
    const summary = builder.build(makeStatus(), true);
    expect(summary.draftRate).toBe(0.75);
  });

  it("reports a draft rate of 0 when there are no approved publishers, avoiding a division by zero", () => {
    const summary = builder.build(makeStatus({ totalApprovedPublishers: 0, draftedCount: 0, skippedCount: 0 }), true);
    expect(summary.draftRate).toBe(0);
  });

  it("passes through the real outreachDataAvailable flag unchanged", () => {
    expect(builder.build(makeStatus(), false).outreachDataAvailable).toBe(false);
    expect(builder.build(makeStatus(), true).outreachDataAvailable).toBe(true);
  });
});
