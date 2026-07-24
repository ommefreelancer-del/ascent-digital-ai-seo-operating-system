import { describe, expect, it } from "vitest";
import { CampaignStatusBuilder } from "../../../../src/agents/campaign-tracking-agent/tracking/campaign-status-builder.js";
import type { OutreachResult, OutreachStatusEntry } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";

function makeOutreach(outreachStatus: OutreachStatusEntry[]): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus,
    skippedPublishers: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("CampaignStatusBuilder", () => {
  const builder = new CampaignStatusBuilder();

  it("reports not-started when there are no real approved publishers", () => {
    const status = builder.build(makeOutreach([]));
    expect(status).toEqual({ phase: "not-started", totalApprovedPublishers: 0, draftedCount: 0, skippedCount: 0 });
  });

  it("reports in-progress and real counts when there is at least one real publisher", () => {
    const status = builder.build(
      makeOutreach([
        { domain: "a.com", status: "drafted", notes: "x" },
        { domain: "b.com", status: "skipped-no-verified-contact", notes: "x" },
      ]),
    );
    expect(status).toEqual({ phase: "in-progress", totalApprovedPublishers: 2, draftedCount: 1, skippedCount: 1 });
  });
});
