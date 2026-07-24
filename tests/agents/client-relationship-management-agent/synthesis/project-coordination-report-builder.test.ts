import { describe, expect, it } from "vitest";
import { ProjectCoordinationReportBuilder } from "../../../../src/agents/client-relationship-management-agent/synthesis/project-coordination-report-builder.js";
import type { GuestPostingDigitalPrResult } from "../../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";

function makeGuestPostingDigitalPr(overrides: Partial<GuestPostingDigitalPrResult> = {}): GuestPostingDigitalPrResult {
  return {
    requestId: "gp-1",
    dataAvailable: true,
    publisherRecords: [],
    campaignPlanSummary: { totalProspects: 0, approvedCount: 0, rejectedCount: 0, outreachDraftedCount: 0, activeNegotiationCount: 0 },
    confirmedPlacements: [],
    campaignPerformanceReport: {
      campaignName: "Plumbing Guest Post Campaign",
      phase: "in-progress",
      draftedCount: 2,
      skippedCount: 1,
      confirmedPlacementCount: 1,
      duplicatesRemoved: 3,
    },
    limitations: [],
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
    spreadsheetSummary: { totalProposedUpdates: 5, clientUpdateCount: 1, publisherUpdateCount: 2, pricingUpdateCount: 2 },
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ProjectCoordinationReportBuilder", () => {
  const builder = new ProjectCoordinationReportBuilder();

  it("combines the real campaign performance report with the real sheet sync state", () => {
    const report = builder.build(makeGuestPostingDigitalPr(), makeGoogleSheets());

    expect(report).toEqual({
      campaignName: "Plumbing Guest Post Campaign",
      phase: "in-progress",
      draftedCount: 2,
      skippedCount: 1,
      confirmedPlacementCount: 1,
      sheetSyncDataAvailable: true,
      sheetProposedUpdateCount: 5,
    });
  });

  it("mirrors sheetSyncDataAvailable false when no real sheet provider is configured", () => {
    const report = builder.build(makeGuestPostingDigitalPr(), makeGoogleSheets({ dataAvailable: false }));
    expect(report.sheetSyncDataAvailable).toBe(false);
  });
});
