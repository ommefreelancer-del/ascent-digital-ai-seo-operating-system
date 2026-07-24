import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientRelationshipManagementAgent } from "../../../src/agents/client-relationship-management-agent/client-relationship-management-agent.js";
import { ClientRelationshipManagementRequestValidator } from "../../../src/agents/client-relationship-management-agent/validation/client-relationship-management-request-validator.js";
import { ClientProfileBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/client-profile-builder.js";
import { SalesPipelineBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/sales-pipeline-builder.js";
import { FinancialSummaryBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/financial-summary-builder.js";
import { ProjectCoordinationReportBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/project-coordination-report-builder.js";
import { ClientRelationshipReportBuilder } from "../../../src/agents/client-relationship-management-agent/synthesis/client-relationship-report-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ClientRelationshipManagementRequest } from "../../../src/agents/client-relationship-management-agent/types/client-relationship-management-request.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../src/agents/business-development-agent/types/business-development-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { GuestPostingDigitalPrResult } from "../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

function makeCrmData(overrides: Partial<AiCrmResult> = {}): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [],
    followUpActivities: [],
    clientStatusReport: [{ clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" }],
    campaignActivity: { campaignName: "Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [],
    limitations: ["CRM limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBusinessDevelopment(overrides: Partial<BusinessDevelopmentResult> = {}): BusinessDevelopmentResult {
  return {
    requestId: "bd-1",
    dataAvailable: true,
    qualifiedLeadReport: [],
    salesPipelineSummary: { totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 },
    clientProposals: [],
    growthOpportunities: [],
    partnershipRecommendations: [],
    limitations: ["Business development limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGoogleSheets(overrides: Partial<GoogleSheetsIntegrationResult> = {}): GoogleSheetsIntegrationResult {
  return {
    requestId: "gs-1",
    dataAvailable: true,
    sheetUpdateProposals: [],
    crmSyncReport: [],
    dataValidationReport: [],
    duplicateFlags: [],
    spreadsheetSummary: { totalProposedUpdates: 3, clientUpdateCount: 1, publisherUpdateCount: 1, pricingUpdateCount: 1 },
    limitations: ["Google Sheets limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGuestPostingDigitalPr(overrides: Partial<GuestPostingDigitalPrResult> = {}): GuestPostingDigitalPrResult {
  return {
    requestId: "gp-1",
    dataAvailable: true,
    publisherRecords: [
      { domain: "example.com", title: "Example Blog", category: "guest-post", qualification: "approved", outreachStatus: "drafted", negotiationStatus: "negotiating", notes: "Real note." },
    ],
    campaignPlanSummary: { totalProspects: 1, approvedCount: 1, rejectedCount: 0, outreachDraftedCount: 1, activeNegotiationCount: 1 },
    confirmedPlacements: [{ domain: "won.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }],
    campaignPerformanceReport: { campaignName: "Plumbing Guest Post Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0, confirmedPlacementCount: 1, duplicatesRemoved: 0 },
    limitations: ["Guest posting limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ClientRelationshipManagementRequest> = {}): ClientRelationshipManagementRequest {
  return {
    id: "req-1",
    crmData: makeCrmData(),
    businessDevelopment: makeBusinessDevelopment(),
    googleSheets: makeGoogleSheets(),
    guestPostingDigitalPr: makeGuestPostingDigitalPr(),
    ...overrides,
  };
}

describe("ClientRelationshipManagementAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "client-relationship-management-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent() {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ClientRelationshipManagementAgent(
      new ClientRelationshipManagementRequestValidator(),
      new ClientProfileBuilder(),
      new SalesPipelineBuilder(),
      new FinancialSummaryBuilder(),
      new ProjectCoordinationReportBuilder(),
      new ClientRelationshipReportBuilder(),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces real client profiles, a sales pipeline report, a financial summary, and a coordination report", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.manageClientRelationships(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.clientProfiles).toHaveLength(1);
    expect(result.salesPipelineReport.pipelineEntries).toHaveLength(1);
    expect(result.salesPipelineReport.wonDeals).toHaveLength(1);
    expect(result.projectCoordinationReport.campaignName).toBe("Plumbing Guest Post Campaign");
    expect(result.clientRelationshipReport.totalClients).toBe(1);
    expect(await readEventTypes(auditLogPath)).toEqual(["client_relationship_management_requested", "client_relationship_management_completed"]);
  });

  it("aggregates real, caller-supplied financial records", async () => {
    const { agent } = buildAgent();

    const result = await agent.manageClientRelationships(
      makeRequest({
        quotations: [{ clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "approved", issuedAt: "2026-07-01T00:00:00.000Z" }],
        contracts: [{ clientName: "Acme Plumbing", status: "signed", effectiveDate: "2026-07-01T00:00:00.000Z" }],
        invoices: [{ clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "overdue", dueDate: "2026-06-01T00:00:00.000Z" }],
      }),
    );

    expect(result.financialSummary.totalQuotedAmount).toBe(500);
    expect(result.financialSummary.approvedQuotationCount).toBe(1);
    expect(result.financialSummary.signedContractCount).toBe(1);
    expect(result.financialSummary.overdueInvoices).toHaveLength(1);
    expect(result.clientRelationshipReport.outstandingInvoiceCount).toBe(1);
  });

  it("carries forward every upstream limitation plus its own standing and conditional disclaimers", async () => {
    const { agent } = buildAgent();
    const result = await agent.manageClientRelationships(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "CRM limitation.",
        "Business development limitation.",
        "Google Sheets limitation.",
        "Guest posting limitation.",
        "No quotations were supplied; the financial summary reflects no real quoted amounts.",
        "No contracts were supplied; the financial summary reflects no real signed contracts.",
        "No invoices were supplied; the financial summary reflects no real outstanding or overdue invoices.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("never sends a quotation, signs a contract"))).toBe(true);
  });

  it("reports dataAvailable false when there is no real activity anywhere upstream", async () => {
    const { agent } = buildAgent();

    const result = await agent.manageClientRelationships(
      makeRequest({
        crmData: makeCrmData({ dataAvailable: false }),
        businessDevelopment: makeBusinessDevelopment({ dataAvailable: false }),
        googleSheets: makeGoogleSheets({ dataAvailable: false }),
        guestPostingDigitalPr: makeGuestPostingDigitalPr({ dataAvailable: false }),
      }),
    );

    expect(result.dataAvailable).toBe(false);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(
      agent.manageClientRelationships(makeRequest({ quotations: [{ clientName: "Acme", amount: -1, currency: "USD", status: "sent", issuedAt: "2026-07-01T00:00:00.000Z" }] })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["client_relationship_management_validation_failed"]);
  });
});
