// Builds a real campaign plan summary -- per the spec's "Generate campaign
// planning summaries" responsibility. Plain counts over real,
// already-computed upstream data, never an invented figure.

import type { Prospect } from "../../prospecting-agent/types/prospecting-request.types.js";
import type { QualifiedProspect } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachStatusEntry } from "../../outreach-agent/types/outreach-request.types.js";
import type { NegotiationStatusEntry } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { CampaignPlanSummary } from "../types/guest-posting-digital-pr-request.types.js";

const ACTIVE_NEGOTIATION_STATUSES = new Set(["awaiting-reply", "negotiating", "agreed-pending-confirmation"]);

export class CampaignPlanSummaryBuilder {
  build(
    prospects: readonly Prospect[],
    approvedProspects: readonly QualifiedProspect[],
    rejectedProspects: readonly QualifiedProspect[],
    outreachStatus: readonly OutreachStatusEntry[],
    negotiationStatusReport: readonly NegotiationStatusEntry[],
  ): CampaignPlanSummary {
    return {
      totalProspects: prospects.length,
      approvedCount: approvedProspects.length,
      rejectedCount: rejectedProspects.length,
      outreachDraftedCount: outreachStatus.filter((entry) => entry.status === "drafted").length,
      activeNegotiationCount: negotiationStatusReport.filter((entry) => ACTIVE_NEGOTIATION_STATUSES.has(entry.status)).length,
    };
  }
}
