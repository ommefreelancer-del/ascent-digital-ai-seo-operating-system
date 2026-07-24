// Builds real sheet update proposals -- per the spec's "Add new client
// records", "Add new publisher records", "Update negotiated pricing",
// "Update outreach status", "Update deal status", and "Update guest posting
// status" responsibilities. Every proposal traces to a real, already-computed
// upstream result; this agent never invents a client, publisher, price, or
// status. Client/publisher proposals are marked "create" only when the real
// GoogleSheetsProvider snapshot shows no existing row for that identifier --
// with no snapshot (no provider configured), every client/publisher
// proposal defaults to "create", since this agent cannot verify an existing
// row without a real read (see GoogleSheetsIntegrationAgent's own
// limitation for this). Pricing/status proposals are always "update": they
// only ever concern a domain that real outreach has already contacted.

import type { ClientStatusEntry, LeadPipelineEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { OutreachStatusEntry } from "../../outreach-agent/types/outreach-request.types.js";
import type { FinalAgreedPrice, NegotiationStatusEntry } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { GoogleSheetsSnapshot } from "../types/google-sheets-provider.types.js";
import type { SheetUpdateProposal } from "../types/google-sheets-integration-request.types.js";

function existsInSnapshot(snapshot: GoogleSheetsSnapshot | null, recordType: "client" | "publisher", identifier: string): boolean {
  return snapshot !== null && snapshot.existingRecords.some((r) => r.recordType === recordType && r.identifier === identifier);
}

export class SheetUpdateProposalBuilder {
  build(
    clientStatusReport: readonly ClientStatusEntry[],
    leadPipeline: readonly LeadPipelineEntry[],
    finalAgreedPricing: readonly FinalAgreedPrice[],
    outreachStatus: readonly OutreachStatusEntry[],
    negotiationStatusReport: readonly NegotiationStatusEntry[],
    campaignTracking: CampaignTrackingResult,
    snapshot: GoogleSheetsSnapshot | null,
  ): SheetUpdateProposal[] {
    const proposals: SheetUpdateProposal[] = [];

    for (const client of clientStatusReport) {
      proposals.push({
        recordCategory: "client",
        action: existsInSnapshot(snapshot, "client", client.clientName) ? "update" : "create",
        identifier: client.clientName,
        summary: `${client.status} (${client.activity})`,
        requiresApproval: true,
      });
    }

    for (const lead of leadPipeline) {
      proposals.push({
        recordCategory: "publisher",
        action: existsInSnapshot(snapshot, "publisher", lead.domain) ? "update" : "create",
        identifier: lead.domain,
        summary: `${lead.stage}: ${lead.notes}`,
        requiresApproval: true,
      });
    }

    for (const price of finalAgreedPricing) {
      proposals.push({
        recordCategory: "pricing",
        action: "update",
        identifier: price.domain,
        summary: `${price.agreedPrice} ${price.currency} confirmed at ${price.confirmedAt}`,
        requiresApproval: true,
      });
    }

    for (const status of outreachStatus) {
      proposals.push({
        recordCategory: "outreach-status",
        action: "update",
        identifier: status.domain,
        summary: `${status.status}: ${status.notes}`,
        requiresApproval: true,
      });
    }

    for (const status of negotiationStatusReport) {
      proposals.push({
        recordCategory: "deal-status",
        action: "update",
        identifier: status.domain,
        summary: `${status.status}: ${status.notes}`,
        requiresApproval: true,
      });
    }

    if (campaignTracking.campaignStatus.totalApprovedPublishers > 0 || campaignTracking.campaignStatus.phase !== "not-started") {
      proposals.push({
        recordCategory: "campaign-status",
        action: "update",
        identifier: campaignTracking.campaignName,
        summary:
          `${campaignTracking.campaignStatus.phase}, drafted ${campaignTracking.campaignStatus.draftedCount}, ` +
          `skipped ${campaignTracking.campaignStatus.skippedCount}`,
        requiresApproval: true,
      });
    }

    return proposals;
  }
}
