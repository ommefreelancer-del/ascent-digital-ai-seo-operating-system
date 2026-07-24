// Builds a real CampaignStatusSummary from the Outreach Agent's own
// already-computed result -- per the spec's "Record campaign status" and
// "Track outreach progress" responsibilities. Phase is deliberately limited
// to "not-started"/"in-progress": this build has no real publisher-response
// data source to ever justify a "completed" determination.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { CampaignPhase, CampaignStatusSummary } from "../types/campaign-tracking-request.types.js";

export class CampaignStatusBuilder {
  build(outreach: OutreachResult): CampaignStatusSummary {
    const totalApprovedPublishers = outreach.outreachStatus.length;
    const draftedCount = outreach.outreachStatus.filter((entry) => entry.status === "drafted").length;
    const skippedCount = outreach.outreachStatus.filter((entry) => entry.status === "skipped-no-verified-contact").length;
    const phase: CampaignPhase = totalApprovedPublishers === 0 ? "not-started" : "in-progress";

    return { phase, totalApprovedPublishers, draftedCount, skippedCount };
  }
}
