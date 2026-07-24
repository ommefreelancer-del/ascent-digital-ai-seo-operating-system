// Builds a real campaign completion report -- per the spec's "Generate
// campaign completion reports" responsibility. Combines the Campaign
// Tracking Agent's own real status with real confirmed placements and the
// real duplicate count the Prospecting Agent already removed -- never an
// invented figure.

import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { CampaignPerformanceReport, ConfirmedPlacement } from "../types/guest-posting-digital-pr-request.types.js";

export class CampaignPerformanceReportBuilder {
  build(
    campaignTracking: CampaignTrackingResult,
    confirmedPlacements: readonly ConfirmedPlacement[],
    duplicatesRemoved: number,
  ): CampaignPerformanceReport {
    return {
      campaignName: campaignTracking.campaignName,
      phase: campaignTracking.campaignStatus.phase,
      draftedCount: campaignTracking.campaignStatus.draftedCount,
      skippedCount: campaignTracking.campaignStatus.skippedCount,
      confirmedPlacementCount: confirmedPlacements.length,
      duplicatesRemoved,
    };
  }
}
