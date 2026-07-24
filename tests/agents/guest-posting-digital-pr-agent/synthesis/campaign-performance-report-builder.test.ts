import { describe, expect, it } from "vitest";
import { CampaignPerformanceReportBuilder } from "../../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-performance-report-builder.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ConfirmedPlacement } from "../../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

function makeCampaignTracking(overrides: Partial<CampaignTrackingResult> = {}): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Plumbing Guest Post Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 2, draftedCount: 2, skippedCount: 1 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CampaignPerformanceReportBuilder", () => {
  const builder = new CampaignPerformanceReportBuilder();

  it("combines real campaign status, confirmed placements, and duplicates removed", () => {
    const placements: ConfirmedPlacement[] = [{ domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }];

    const report = builder.build(makeCampaignTracking(), placements, 3);

    expect(report).toEqual({
      campaignName: "Plumbing Guest Post Campaign",
      phase: "in-progress",
      draftedCount: 2,
      skippedCount: 1,
      confirmedPlacementCount: 1,
      duplicatesRemoved: 3,
    });
  });

  it("reports zero confirmed placements when there are none", () => {
    const report = builder.build(makeCampaignTracking(), [], 0);
    expect(report.confirmedPlacementCount).toBe(0);
  });
});
