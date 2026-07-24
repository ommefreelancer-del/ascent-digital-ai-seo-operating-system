import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_CRM_AGENT_ID, isAiCrmAssignment } from "../../../src/agents/ai-crm-agent/dispatch.js";
import { AiCrmAgent } from "../../../src/agents/ai-crm-agent/ai-crm-agent.js";
import { AiCrmRequestValidator } from "../../../src/agents/ai-crm-agent/validation/ai-crm-request-validator.js";
import { LeadPipelineBuilder } from "../../../src/agents/ai-crm-agent/crm/lead-pipeline-builder.js";
import { FollowUpActivityBuilder } from "../../../src/agents/ai-crm-agent/crm/follow-up-activity-builder.js";
import { ClientStatusReportBuilder } from "../../../src/agents/ai-crm-agent/crm/client-status-report-builder.js";
import { CampaignActivityReportBuilder } from "../../../src/agents/ai-crm-agent/crm/campaign-activity-report-builder.js";
import { CrmRecordUpdateBuilder } from "../../../src/agents/ai-crm-agent/crm/crm-record-update-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: AI_CRM_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isAiCrmAssignment", () => {
  it("is true when the decision is assigned to the AI CRM agent", () => {
    expect(isAiCrmAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isAiCrmAssignment(makeDecision({ assignedAgentId: "reply-negotiation-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isAiCrmAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "ai-crm-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to AiCrmResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-37" });
    expect(isAiCrmAssignment(decision)).toBe(true);

    const agent = new AiCrmAgent(
      new AiCrmRequestValidator(),
      new LeadPipelineBuilder(),
      new FollowUpActivityBuilder(),
      new ClientStatusReportBuilder(),
      new CampaignActivityReportBuilder(),
      new CrmRecordUpdateBuilder(),
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

    const result = await agent.manageCrm({ id: decision.taskId, outreach, campaignTracking, replyNegotiation });

    expect(result.requestId).toBe("boss-agent-task-37");
  });
});
