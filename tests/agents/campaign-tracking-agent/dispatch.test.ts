import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAMPAIGN_TRACKING_AGENT_ID, isCampaignTrackingAssignment } from "../../../src/agents/campaign-tracking-agent/dispatch.js";
import { CampaignTrackingAgent } from "../../../src/agents/campaign-tracking-agent/campaign-tracking-agent.js";
import { CampaignTrackingRequestValidator } from "../../../src/agents/campaign-tracking-agent/validation/campaign-tracking-request-validator.js";
import { CampaignStatusBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/campaign-status-builder.js";
import { ProgressReportBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/progress-report-builder.js";
import { PerformanceSummaryBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/performance-summary-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: CAMPAIGN_TRACKING_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isCampaignTrackingAssignment", () => {
  it("is true when the decision is assigned to the campaign tracking agent", () => {
    expect(isCampaignTrackingAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isCampaignTrackingAssignment(makeDecision({ assignedAgentId: "outreach-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isCampaignTrackingAssignment({
        taskId: "task-1",
        status: "rejected",
        candidates: [],
        rationale: "Declined.",
        decidedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("integration: a Boss Agent routing decision can be traced through to a real result", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "campaign-tracking-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to CampaignTrackingResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-33" });
    expect(isCampaignTrackingAssignment(decision)).toBe(true);

    const agent = new CampaignTrackingAgent(
      new CampaignTrackingRequestValidator(),
      new CampaignStatusBuilder(),
      new ProgressReportBuilder(),
      new PerformanceSummaryBuilder(),
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const outreach: OutreachResult = {
      requestId: "out-1",
      dataAvailable: false,
      outreachDrafts: [],
      followUpSchedule: [],
      outreachStatus: [],
      skippedPublishers: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.trackCampaign({
      id: decision.taskId,
      campaignName: "Plumbing Guest Post Campaign",
      outreach,
    });

    expect(result.requestId).toBe("boss-agent-task-33");
  });
});
