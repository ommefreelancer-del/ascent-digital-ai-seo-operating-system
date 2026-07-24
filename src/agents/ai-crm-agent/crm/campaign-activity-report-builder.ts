// Builds a real campaign activity report -- per the spec's "Maintain
// campaign records" responsibility. Relays the Campaign Tracking Agent's
// own real, already-computed status; this builder never re-derives it.

import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { CampaignActivityEntry } from "../types/ai-crm-request.types.js";

export class CampaignActivityReportBuilder {
  build(campaignTracking: CampaignTrackingResult): CampaignActivityEntry {
    return {
      campaignName: campaignTracking.campaignName,
      phase: campaignTracking.campaignStatus.phase,
      draftedCount: campaignTracking.campaignStatus.draftedCount,
      skippedCount: campaignTracking.campaignStatus.skippedCount,
    };
  }
}
