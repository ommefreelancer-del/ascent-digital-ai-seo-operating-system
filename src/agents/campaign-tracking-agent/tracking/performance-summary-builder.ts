// Builds a real PerformanceSummary from the already-computed
// CampaignStatusSummary -- per the spec's own "Performance summary"
// output. draftRate is plain arithmetic over real counts, never an
// invented percentage.

import type { CampaignStatusSummary, PerformanceSummary } from "../types/campaign-tracking-request.types.js";

export class PerformanceSummaryBuilder {
  build(campaignStatus: CampaignStatusSummary, outreachDataAvailable: boolean): PerformanceSummary {
    const draftRate =
      campaignStatus.totalApprovedPublishers === 0
        ? 0
        : campaignStatus.draftedCount / campaignStatus.totalApprovedPublishers;

    return { draftRate, outreachDataAvailable };
  }
}
