import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_AGENT_ID, isAdminAssignment } from "../../../src/agents/admin-agent/dispatch.js";
import { AdminAgent } from "../../../src/agents/admin-agent/admin-agent.js";
import { AdminRequestValidator } from "../../../src/agents/admin-agent/validation/admin-request-validator.js";
import { DocumentOrganizer } from "../../../src/agents/admin-agent/organizing/document-organizer.js";
import { SopReviewFlagBuilder } from "../../../src/agents/admin-agent/organizing/sop-review-flag-builder.js";
import { ProjectStatusReportBuilder } from "../../../src/agents/admin-agent/organizing/project-status-report-builder.js";
import { AdministrativeRecordBuilder } from "../../../src/agents/admin-agent/organizing/administrative-record-builder.js";
import { ComplianceChecklistBuilder } from "../../../src/agents/admin-agent/organizing/compliance-checklist-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import { CliApprovalChannel } from "../../../src/core/governance/cli-approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: ADMIN_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isAdminAssignment", () => {
  it("is true when the decision is assigned to the Admin Agent", () => {
    expect(isAdminAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isAdminAssignment(makeDecision({ assignedAgentId: "business-development-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isAdminAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "admin-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to AdminResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-64" });
    expect(isAdminAssignment(decision)).toBe(true);

    const agent = new AdminAgent(
      new AdminRequestValidator(),
      new DocumentOrganizer(),
      new SopReviewFlagBuilder(),
      new ProjectStatusReportBuilder(),
      new AdministrativeRecordBuilder(),
      new ComplianceChecklistBuilder(),
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
    const businessDevelopment: BusinessDevelopmentResult = {
      requestId: "bd-1",
      dataAvailable: false,
      qualifiedLeadReport: [],
      salesPipelineSummary: { totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 },
      clientProposals: [],
      growthOpportunities: [],
      partnershipRecommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.manageAdmin({ id: decision.taskId, crmData, businessDevelopment });

    expect(result.requestId).toBe("boss-agent-task-64");
  });
});
