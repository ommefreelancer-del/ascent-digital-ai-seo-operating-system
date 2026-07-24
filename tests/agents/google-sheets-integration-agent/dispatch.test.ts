import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GOOGLE_SHEETS_INTEGRATION_AGENT_ID, isGoogleSheetsIntegrationAssignment } from "../../../src/agents/google-sheets-integration-agent/dispatch.js";
import { GoogleSheetsIntegrationAgent } from "../../../src/agents/google-sheets-integration-agent/google-sheets-integration-agent.js";
import { GoogleSheetsIntegrationRequestValidator } from "../../../src/agents/google-sheets-integration-agent/validation/google-sheets-integration-request-validator.js";
import { NullGoogleSheetsProvider } from "../../../src/agents/google-sheets-integration-agent/providers/null-google-sheets-provider.js";
import { SheetUpdateProposalBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/sheet-update-proposal-builder.js";
import { CrmSyncReportBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/crm-sync-report-builder.js";
import { DataValidationReportBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/data-validation-report-builder.js";
import { DuplicateRecordFlagBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/duplicate-record-flag-builder.js";
import { SpreadsheetSummaryBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/spreadsheet-summary-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import { CliApprovalChannel } from "../../../src/core/governance/cli-approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isGoogleSheetsIntegrationAssignment", () => {
  it("is true when the decision is assigned to the Google Sheets Integration Agent", () => {
    expect(isGoogleSheetsIntegrationAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isGoogleSheetsIntegrationAssignment(makeDecision({ assignedAgentId: "ai-crm-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isGoogleSheetsIntegrationAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "google-sheets-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to GoogleSheetsIntegrationResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-77" });
    expect(isGoogleSheetsIntegrationAssignment(decision)).toBe(true);

    const agent = new GoogleSheetsIntegrationAgent(
      new GoogleSheetsIntegrationRequestValidator(),
      new NullGoogleSheetsProvider(),
      new SheetUpdateProposalBuilder(),
      new CrmSyncReportBuilder(),
      new DataValidationReportBuilder(),
      new DuplicateRecordFlagBuilder(),
      new SpreadsheetSummaryBuilder(),
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

    const result = await agent.syncSheets({
      id: decision.taskId,
      spreadsheetId: "sheet-123",
      crmData,
      outreach,
      campaignTracking,
      replyNegotiation,
    });

    expect(result.requestId).toBe("boss-agent-task-77");
  });
});
