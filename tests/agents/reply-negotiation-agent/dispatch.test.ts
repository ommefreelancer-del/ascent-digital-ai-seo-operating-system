import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REPLY_NEGOTIATION_AGENT_ID,
  isReplyNegotiationAssignment,
} from "../../../src/agents/reply-negotiation-agent/dispatch.js";
import { ReplyNegotiationAgent } from "../../../src/agents/reply-negotiation-agent/reply-negotiation-agent.js";
import { ReplyNegotiationRequestValidator } from "../../../src/agents/reply-negotiation-agent/validation/reply-negotiation-request-validator.js";
import { NullPublisherReplyProvider } from "../../../src/agents/reply-negotiation-agent/providers/null-publisher-reply-provider.js";
import { ConversationSummaryBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/conversation-summary-builder.js";
import { QuotedTermsBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/quoted-terms-builder.js";
import { NegotiationRecommendationBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-recommendation-builder.js";
import { NegotiationReplyDraftBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-reply-draft-builder.js";
import { NegotiationStatusBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-status-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: REPLY_NEGOTIATION_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isReplyNegotiationAssignment", () => {
  it("is true when the decision is assigned to the reply negotiation agent", () => {
    expect(isReplyNegotiationAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isReplyNegotiationAssignment(makeDecision({ assignedAgentId: "campaign-tracking-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isReplyNegotiationAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "reply-negotiation-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ReplyNegotiationResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-35" });
    expect(isReplyNegotiationAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when there are no within-target quotes to confirm");
      },
    };
    const agent = new ReplyNegotiationAgent(
      new ReplyNegotiationRequestValidator(),
      new NullPublisherReplyProvider(),
      new ConversationSummaryBuilder(),
      new QuotedTermsBuilder(),
      new NegotiationRecommendationBuilder(),
      new NegotiationReplyDraftBuilder(),
      new NegotiationStatusBuilder(),
      approvalChannel,
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

    const result = await agent.manageNegotiations({
      id: decision.taskId,
      outreach,
      campaignTracking,
      targetPricing: { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" },
    });

    expect(result.requestId).toBe("boss-agent-task-35");
  });
});
