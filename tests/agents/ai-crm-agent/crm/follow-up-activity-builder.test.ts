import { describe, expect, it } from "vitest";
import { FollowUpActivityBuilder } from "../../../../src/agents/ai-crm-agent/crm/follow-up-activity-builder.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";

function makeOutreach(followUpSchedule: OutreachResult["followUpSchedule"]): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule,
    outreachStatus: [],
    skippedPublishers: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("FollowUpActivityBuilder", () => {
  const builder = new FollowUpActivityBuilder();

  it("returns no activities when there is no real follow-up schedule", () => {
    expect(builder.build(makeOutreach([]))).toEqual([]);
  });

  it("builds a real activity entry per scheduled follow-up", () => {
    const [activity] = builder.build(
      makeOutreach([{ domain: "example.com", sequenceNumber: 1, scheduledDate: "2026-07-08T00:00:00.000Z", messageDraft: "x", requiresApproval: true }]),
    );
    expect(activity).toEqual({ domain: "example.com", scheduledDate: "2026-07-08T00:00:00.000Z", description: "Follow-up #1 scheduled." });
  });
});
