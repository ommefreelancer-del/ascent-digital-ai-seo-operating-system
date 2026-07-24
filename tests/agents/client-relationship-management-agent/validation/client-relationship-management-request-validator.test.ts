import { describe, expect, it } from "vitest";
import {
  ClientRelationshipManagementRequestValidator,
  ClientRelationshipManagementValidationError,
} from "../../../../src/agents/client-relationship-management-agent/validation/client-relationship-management-request-validator.js";
import type {
  ClientRelationshipManagementRequest,
  ContractEntry,
  InvoiceEntry,
  QuotationEntry,
} from "../../../../src/agents/client-relationship-management-agent/types/client-relationship-management-request.types.js";
import type { AiCrmResult } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { GuestPostingDigitalPrResult } from "../../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

function makeCrmData(): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [],
    followUpActivities: [],
    clientStatusReport: [],
    campaignActivity: { campaignName: "Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeBusinessDevelopment(): BusinessDevelopmentResult {
  return {
    requestId: "bd-1",
    dataAvailable: true,
    qualifiedLeadReport: [],
    salesPipelineSummary: { totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 },
    clientProposals: [],
    growthOpportunities: [],
    partnershipRecommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeGoogleSheets(): GoogleSheetsIntegrationResult {
  return {
    requestId: "gs-1",
    dataAvailable: true,
    sheetUpdateProposals: [],
    crmSyncReport: [],
    dataValidationReport: [],
    duplicateFlags: [],
    spreadsheetSummary: { totalProposedUpdates: 0, clientUpdateCount: 0, publisherUpdateCount: 0, pricingUpdateCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeGuestPostingDigitalPr(): GuestPostingDigitalPrResult {
  return {
    requestId: "gp-1",
    dataAvailable: true,
    publisherRecords: [],
    campaignPlanSummary: { totalProspects: 0, approvedCount: 0, rejectedCount: 0, outreachDraftedCount: 0, activeNegotiationCount: 0 },
    confirmedPlacements: [],
    campaignPerformanceReport: { campaignName: "Campaign", phase: "in-progress", draftedCount: 0, skippedCount: 0, confirmedPlacementCount: 0, duplicatesRemoved: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeQuotation(overrides: Partial<QuotationEntry> = {}): QuotationEntry {
  return { clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "sent", issuedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeContract(overrides: Partial<ContractEntry> = {}): ContractEntry {
  return { clientName: "Acme Plumbing", status: "signed", effectiveDate: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeInvoice(overrides: Partial<InvoiceEntry> = {}): InvoiceEntry {
  return { clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "issued", dueDate: "2026-08-01T00:00:00.000Z", ...overrides };
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

describe("ClientRelationshipManagementRequestValidator", () => {
  const validator = new ClientRelationshipManagementRequestValidator();

  it("accepts a well-formed request with no optional fields", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("accepts a well-formed request with all optional fields", () => {
    expect(() =>
      validator.validate(makeRequest({ quotations: [makeQuotation()], contracts: [makeContract()], invoices: [makeInvoice()] })),
    ).not.toThrow();
  });

  it("throws when a quotation has a blank clientName", () => {
    expect(() => validator.validate(makeRequest({ quotations: [makeQuotation({ clientName: "  " })] }))).toThrow(
      ClientRelationshipManagementValidationError,
    );
  });

  it("throws when a quotation has a negative amount", () => {
    expect(() => validator.validate(makeRequest({ quotations: [makeQuotation({ amount: -1 })] }))).toThrow(
      ClientRelationshipManagementValidationError,
    );
  });

  it("throws when a contract has a blank clientName", () => {
    expect(() => validator.validate(makeRequest({ contracts: [makeContract({ clientName: "  " })] }))).toThrow(
      ClientRelationshipManagementValidationError,
    );
  });

  it("throws when an invoice has a blank clientName", () => {
    expect(() => validator.validate(makeRequest({ invoices: [makeInvoice({ clientName: "  " })] }))).toThrow(
      ClientRelationshipManagementValidationError,
    );
  });

  it("throws when an invoice has a negative amount", () => {
    expect(() => validator.validate(makeRequest({ invoices: [makeInvoice({ amount: -1 })] }))).toThrow(
      ClientRelationshipManagementValidationError,
    );
  });
});
