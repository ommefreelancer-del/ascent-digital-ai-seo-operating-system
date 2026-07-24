// Builds a real project coordination report -- per the spec's "Coordinate
// project status across campaigns" responsibility. Combines the Guest
// Posting & Digital PR Agent's own real campaign performance report with
// the Google Sheets Integration Agent's own real sync state; never invents
// a project status.

import type { GuestPostingDigitalPrResult } from "../../guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { ProjectCoordinationReport } from "../types/client-relationship-management-request.types.js";

export class ProjectCoordinationReportBuilder {
  build(guestPostingDigitalPr: GuestPostingDigitalPrResult, googleSheets: GoogleSheetsIntegrationResult): ProjectCoordinationReport {
    return {
      campaignName: guestPostingDigitalPr.campaignPerformanceReport.campaignName,
      phase: guestPostingDigitalPr.campaignPerformanceReport.phase,
      draftedCount: guestPostingDigitalPr.campaignPerformanceReport.draftedCount,
      skippedCount: guestPostingDigitalPr.campaignPerformanceReport.skippedCount,
      confirmedPlacementCount: guestPostingDigitalPr.campaignPerformanceReport.confirmedPlacementCount,
      sheetSyncDataAvailable: googleSheets.dataAvailable,
      sheetProposedUpdateCount: googleSheets.spreadsheetSummary.totalProposedUpdates,
    };
  }
}
