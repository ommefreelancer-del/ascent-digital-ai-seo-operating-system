import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GUEST_POSTING_DIGITAL_PR_AGENT_ID, isGuestPostingDigitalPrAssignment } from "../../../src/agents/guest-posting-digital-pr-agent/dispatch.js";
import { GuestPostingDigitalPrAgent } from "../../../src/agents/guest-posting-digital-pr-agent/guest-posting-digital-pr-agent.js";
import { GuestPostingDigitalPrRequestValidator } from "../../../src/agents/guest-posting-digital-pr-agent/validation/guest-posting-digital-pr-request-validator.js";
import { PublisherRecordBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/publisher-record-builder.js";
import { CampaignPlanSummaryBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-plan-summary-builder.js";
import { ConfirmedPlacementBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/confirmed-placement-builder.js";
import { CampaignPerformanceReportBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-performance-report-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { ProspectingResult } from "../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type { PublisherQualificationResult } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: GUEST_POSTING_DIGITAL_PR_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isGuestPostingDigitalPrAssignment", () => {
  it("is true when the decision is assigned to the Guest Posting & Digital PR Agent", () => {
    expect(isGuestPostingDigitalPrAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isGuestPostingDigitalPrAssignment(makeDecision({ assignedAgentId: "outreach-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isGuestPostingDigitalPrAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "guest-posting-digital-pr-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to GuestPostingDigitalPrResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-88" });
    expect(isGuestPostingDigitalPrAssignment(decision)).toBe(true);

    const agent = new GuestPostingDigitalPrAgent(
      new GuestPostingDigitalPrRequestValidator(),
      new PublisherRecordBuilder(),
      new CampaignPlanSummaryBuilder(),
      new ConfirmedPlacementBuilder(),
      new CampaignPerformanceReportBuilder(),
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const prospecting: ProspectingResult = { requestId: "p-1", dataAvailable: false, prospects: [], duplicatesRemoved: 0, limitations: [], decidedAt: new Date().toISOString() };
    const publisherQualification: PublisherQualificationResult = { requestId: "pq-1", dataAvailable: false, approvedProspects: [], rejectedProspects: [], limitations: [], decidedAt: new Date().toISOString() };
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
    const campaignTracking: CampaignTrackingResult = {
      requestId: "ct-1",
      campaignName: "Campaign",
      dataAvailable: false,
      campaignStatus: { phase: "not-started", totalApprovedPublishers: 0, draftedCount: 0, skippedCount: 0 },
      progressReports: [],
      performanceSummary: { draftRate: 0, outreachDataAvailable: false },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const replyNegotiation: ReplyNegotiationResult = {
      requestId: "rn-1",
      dataAvailable: false,
      conversationSummaries: [],
      quotedTerms: [],
      negotiationRecommendations: [],
      replyDrafts: [],
      finalAgreedPricing: [],
      negotiationStatusReport: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.manageGuestPostingDigitalPr({
      id: decision.taskId,
      campaignName: "Campaign",
      prospecting,
      publisherQualification,
      outreach,
      campaignTracking,
      replyNegotiation,
    });

    expect(result.requestId).toBe("boss-agent-task-88");
  });
});
