import { describe, expect, it } from "vitest";
import { CampaignActivityReportBuilder } from "../../../../src/agents/ai-crm-agent/crm/campaign-activity-report-builder.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

function makeCampaignTracking(overrides: Partial<CampaignTrackingResult> = {}): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Plumbing Guest Post Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 3, draftedCount: 2, skippedCount: 1 },
    progressReports: [],
    performanceSummary: { draftRate: 0.66, outreachDataAvailable: true },
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CampaignActivityReportBuilder", () => {
  const builder = new CampaignActivityReportBuilder();

  it("relays the real campaign name, phase, and counts unchanged", () => {
    const activity = builder.build(makeCampaignTracking());
    expect(activity).toEqual({
      campaignName: "Plumbing Guest Post Campaign",
      phase: "in-progress",
      draftedCount: 2,
      skippedCount: 1,
    });
  });
});
