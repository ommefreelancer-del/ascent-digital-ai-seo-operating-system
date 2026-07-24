import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_RELATIONSHIP_MANAGEMENT_AGENT_ID, isClientRelationshipManagementAssignment } from "../../../src/agents/client-relationship-management-agent/dispatch.js";
import { ClientRelationshipManagementAgent } from "../../../src/agents/client-relationship-management-agent/client-relationship-management-agent.js";
import { ClientRelationshipManagementRequestValidator } from "../../../src/agents/client-relationship-management-agent/validation/client-relationship-management-request-validator.js";
import { ClientProfileBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/client-profile-builder.js";
import { SalesPipelineBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/sales-pipeline-builder.js";
import { FinancialSummaryBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/financial-summary-builder.js";
import { ProjectCoordinationReportBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/project-coordination-report-builder.js";
import { ClientRelationshipReportBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/client-relationship-report-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../src/agents/business-development-agent/types/business-development-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { GuestPostingDigitalPrResult } from "../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: CLIENT_RELATIONSHIP_MANAGEMENT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isClientRelationshipManagementAssignment", () => {
  it("is true when the decision is assigned to the Client Relationship Management Agent", () => {
    expect(isClientRelationshipManagementAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isClientRelationshipManagementAssignment(makeDecision({ assignedAgentId: "ai-crm-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isClientRelationshipManagementAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "client-relationship-management-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ClientRelationshipManagementResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-99" });
    expect(isClientRelationshipManagementAssignment(decision)).toBe(true);

    const agent = new ClientRelationshipManagementAgent(
      new ClientRelationshipManagementRequestValidator(),
      new ClientProfileBuilder(),
      new SalesPipelineBuilder(),
      new FinancialSummaryBuilder(),
      new ProjectCoordinationReportBuilder(),
      new ClientRelationshipReportBuilder(),
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
    const googleSheets: GoogleSheetsIntegrationResult = {
      requestId: "gs-1",
      dataAvailable: false,
      sheetUpdateProposals: [],
      crmSyncReport: [],
      dataValidationReport: [],
      duplicateFlags: [],
      spreadsheetSummary: { totalProposedUpdates: 0, clientUpdateCount: 0, publisherUpdateCount: 0, pricingUpdateCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const guestPostingDigitalPr: GuestPostingDigitalPrResult = {
      requestId: "gp-1",
      dataAvailable: false,
      publisherRecords: [],
      campaignPlanSummary: { totalProspects: 0, approvedCount: 0, rejectedCount: 0, outreachDraftedCount: 0, activeNegotiationCount: 0 },
      confirmedPlacements: [],
      campaignPerformanceReport: { campaignName: "Campaign", phase: "not-started", draftedCount: 0, skippedCount: 0, confirmedPlacementCount: 0, duplicatesRemoved: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.manageClientRelationships({
      id: decision.taskId,
      crmData,
      businessDevelopment,
      googleSheets,
      guestPostingDigitalPr,
    });

    expect(result.requestId).toBe("boss-agent-task-99");
  });
});
