import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_DEVELOPMENT_AGENT_ID, isBusinessDevelopmentAssignment } from "../../../src/agents/business-development-agent/dispatch.js";
import { BusinessDevelopmentAgent } from "../../../src/agents/business-development-agent/business-development-agent.js";
import { BusinessDevelopmentRequestValidator } from "../../../src/agents/business-development-agent/validation/business-development-request-validator.js";
import { LeadQualifier } from "../../../src/agents/business-development-agent/development/lead-qualifier.js";
import { SalesPipelineSummaryBuilder } from "../../../src/agents/business-development-agent/development/sales-pipeline-summary-builder.js";
import { ClientProposalDraftBuilder } from "../../../src/agents/business-development-agent/development/client-proposal-draft-builder.js";
import { GrowthOpportunityBuilder } from "../../../src/agents/business-development-agent/development/growth-opportunity-builder.js";
import { PartnershipRecommendationBuilder } from "../../../src/agents/business-development-agent/development/partnership-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import { CliApprovalChannel } from "../../../src/core/governance/cli-approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: BUSINESS_DEVELOPMENT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isBusinessDevelopmentAssignment", () => {
  it("is true when the decision is assigned to the Business Development Agent", () => {
    expect(isBusinessDevelopmentAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isBusinessDevelopmentAssignment(makeDecision({ assignedAgentId: "ai-crm-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isBusinessDevelopmentAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "business-development-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to BusinessDevelopmentResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-51" });
    expect(isBusinessDevelopmentAssignment(decision)).toBe(true);

    const agent = new BusinessDevelopmentAgent(
      new BusinessDevelopmentRequestValidator(),
      new LeadQualifier(),
      new SalesPipelineSummaryBuilder(),
      new ClientProposalDraftBuilder(),
      new GrowthOpportunityBuilder(),
      new PartnershipRecommendationBuilder(),
      new CliApprovalChannel(),
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const crmData: AiCrmResult = {
      requestId: "crm-1",
      dataAvailable: false,
      leadPipeline: [],
      followUpActivities: [],
      clientStatusReport: [],
      campaignActivity: { campaignName: "Campaign", phase: "not-started", draftedCount: 0, skippedCount: 0 },
      crmRecordUpdates: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developBusiness({
      id: decision.taskId,
      crmData,
      businessGoals: "Grow revenue.",
      servicePortfolio: [],
    });

    expect(result.requestId).toBe("boss-agent-task-51");
  });
});
