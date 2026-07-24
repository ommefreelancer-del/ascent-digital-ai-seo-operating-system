import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoogleSheetsIntegrationAgent } from "../../../src/agents/google-sheets-integration-agent/google-sheets-integration-agent.js";
import { GoogleSheetsIntegrationRequestValidator } from "../../../src/agents/google-sheets-integration-agent/validation/google-sheets-integration-request-validator.js";
import { NullGoogleSheetsProvider } from "../../../src/agents/google-sheets-integration-agent/providers/null-google-sheets-provider.js";
import { SheetUpdateProposalBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/sheet-update-proposal-builder.js";
import { CrmSyncReportBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/crm-sync-report-builder.js";
import { DataValidationReportBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/data-validation-report-builder.js";
import { DuplicateRecordFlagBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/duplicate-record-flag-builder.js";
import { SpreadsheetSummaryBuilder } from "../../../src/agents/google-sheets-integration-agent/synthesis/spreadsheet-summary-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { GoogleSheetsIntegrationRequest } from "../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { GoogleSheetsProvider, GoogleSheetsSnapshot } from "../../../src/agents/google-sheets-integration-agent/types/google-sheets-provider.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedGoogleSheetsProvider implements GoogleSheetsProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: GoogleSheetsSnapshot) {}
  async fetchSheetSnapshot(): Promise<GoogleSheetsSnapshot | null> {
    return this.snapshot;
  }
}

function makeCrmData(overrides: Partial<AiCrmResult> = {}): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [{ domain: "example.com", stage: "negotiating", notes: "Real note." }],
    followUpActivities: [],
    clientStatusReport: [{ clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" }],
    campaignActivity: { campaignName: "Plumbing Guest Post Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [{ recordType: "client", action: "update", identifier: "Acme Plumbing", summary: "Real summary.", requiresApproval: true }],
    limitations: ["CRM limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOutreach(overrides: Partial<OutreachResult> = {}): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus: [{ domain: "example.com", status: "drafted", notes: "Real note." }],
    skippedPublishers: [],
    limitations: ["Outreach limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCampaignTracking(overrides: Partial<CampaignTrackingResult> = {}): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Plumbing Guest Post Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 1, draftedCount: 1, skippedCount: 0 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: ["Campaign tracking limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReplyNegotiation(overrides: Partial<ReplyNegotiationResult> = {}): ReplyNegotiationResult {
  return {
    requestId: "rn-1",
    dataAvailable: true,
    conversationSummaries: [],
    quotedTerms: [],
    negotiationRecommendations: [],
    replyDrafts: [],
    finalAgreedPricing: [{ domain: "example.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }],
    negotiationStatusReport: [{ domain: "example.com", status: "agreed-confirmed", notes: "Real note." }],
    limitations: ["Reply negotiation limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<GoogleSheetsIntegrationRequest> = {}): GoogleSheetsIntegrationRequest {
  return {
    id: "req-1",
    spreadsheetId: "sheet-123",
    crmData: makeCrmData(),
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    replyNegotiation: makeReplyNegotiation(),
    ...overrides,
  };
}

describe("GoogleSheetsIntegrationAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "google-sheets-integration-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: GoogleSheetsProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new GoogleSheetsIntegrationAgent(
      new GoogleSheetsIntegrationRequestValidator(),
      provider,
      new SheetUpdateProposalBuilder(),
      new CrmSyncReportBuilder(),
      new DataValidationReportBuilder(),
      new DuplicateRecordFlagBuilder(),
      new SpreadsheetSummaryBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces real sheet update proposals, a CRM sync report, and a spreadsheet summary with the default NullGoogleSheetsProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGoogleSheetsProvider());

    const result = await agent.syncSheets(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.sheetUpdateProposals.length).toBeGreaterThan(0);
    expect(result.sheetUpdateProposals.find((p) => p.recordCategory === "client")?.action).toBe("create");
    expect(result.crmSyncReport).toEqual([{ identifier: "Acme Plumbing", summary: "update client: Real summary." }]);
    expect(result.spreadsheetSummary.totalProposedUpdates).toBe(result.sheetUpdateProposals.length);
    expect(result.duplicateFlags).toEqual([]);
    expect(await readEventTypes(auditLogPath)).toEqual(["google_sheets_integration_requested", "google_sheets_integration_completed"]);
  });

  it("marks dataAvailable true and proposes updates when a real GoogleSheetsProvider snapshot is configured", async () => {
    const snapshot: GoogleSheetsSnapshot = {
      spreadsheetId: "sheet-123",
      existingRecords: [{ recordType: "client", identifier: "Acme Plumbing" }],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent } = buildAgent(new FixedGoogleSheetsProvider(snapshot));

    const result = await agent.syncSheets(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.sheetUpdateProposals.find((p) => p.recordCategory === "client")?.action).toBe("update");
  });

  it("flags a real duplicate found in the provider snapshot", async () => {
    const snapshot: GoogleSheetsSnapshot = {
      spreadsheetId: "sheet-123",
      existingRecords: [
        { recordType: "client", identifier: "Acme Plumbing" },
        { recordType: "client", identifier: "Acme Plumbing" },
      ],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent } = buildAgent(new FixedGoogleSheetsProvider(snapshot));

    const result = await agent.syncSheets(makeRequest());

    expect(result.duplicateFlags).toEqual([{ recordType: "client", identifier: "Acme Plumbing", note: "2 real rows found for this client in the spreadsheet." }]);
  });

  it("flags an inconsistency between negotiation status and agreed pricing", async () => {
    const { agent } = buildAgent(new NullGoogleSheetsProvider());

    const result = await agent.syncSheets(makeRequest({ replyNegotiation: makeReplyNegotiation({ finalAgreedPricing: [] }) }));

    expect(result.dataValidationReport).toEqual([
      { identifier: "example.com", issue: "Marked agreed-confirmed but no confirmed price is recorded for this domain." },
    ]);
  });

  it("carries forward every upstream limitation and notes the missing provider", async () => {
    const { agent } = buildAgent(new NullGoogleSheetsProvider());
    const result = await agent.syncSheets(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "CRM limitation.",
        "Outreach limitation.",
        "Campaign tracking limitation.",
        "Reply negotiation limitation.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(result.limitations.some((l) => l.includes("never calls the Google Sheets API"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGoogleSheetsProvider());

    await expect(agent.syncSheets(makeRequest({ spreadsheetId: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["google_sheets_integration_validation_failed"]);
  });

  it("escalates a destructive-action signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullGoogleSheetsProvider(), approvingDecision);

    const result = await agent.syncSheets(makeRequest({ userInstructions: "Please overwrite the pricing column." }));

    expect(result.sheetUpdateProposals.length).toBeGreaterThan(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "google_sheets_integration_requested",
      "google_sheets_integration_escalated",
      "google_sheets_integration_escalation_resolved",
      "google_sheets_integration_completed",
    ]);
  });

  it("rejects when a human declines the destructive-action escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGoogleSheetsProvider(), REJECTING_DECISION);

    await expect(agent.syncSheets(makeRequest({ userInstructions: "Please overwrite the pricing column." }))).rejects.toThrow(
      /destructive-action/,
    );

    expect(await readEventTypes(auditLogPath)).toEqual([
      "google_sheets_integration_requested",
      "google_sheets_integration_escalated",
      "google_sheets_integration_escalation_resolved",
      "google_sheets_integration_rejected",
    ]);
  });
});
