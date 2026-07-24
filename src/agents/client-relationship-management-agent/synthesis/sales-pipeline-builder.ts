// Builds a real sales pipeline report -- per the spec's "Track real sales
// pipeline stages" responsibility. Reuses the Guest Posting & Digital PR
// Agent's own real, per-domain negotiation status and confirmed placements
// exclusively -- this agent never reaches further upstream to the Reply &
// Negotiation Agent directly, and never invents a pipeline stage beyond
// what real evidence supports (see ClientPipelineStage's own documentation).

import type { NegotiationStatus } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { ConfirmedPlacement, PublisherRecord } from "../../guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";
import type { ClientPipelineStage, SalesPipelineReport } from "../types/client-relationship-management-request.types.js";

const PIPELINE_STAGE_BY_NEGOTIATION_STATUS: Partial<Record<NegotiationStatus, ClientPipelineStage>> = {
  "awaiting-reply": "contacted",
  negotiating: "negotiation",
  "agreed-pending-confirmation": "awaiting-approval",
};

export class SalesPipelineBuilder {
  build(publisherRecords: readonly PublisherRecord[], confirmedPlacements: readonly ConfirmedPlacement[]): SalesPipelineReport {
    const pipelineEntries = publisherRecords.flatMap((record) => {
      const stage = record.negotiationStatus ? PIPELINE_STAGE_BY_NEGOTIATION_STATUS[record.negotiationStatus] : undefined;
      return stage ? [{ domain: record.domain, stage, notes: record.notes }] : [];
    });

    const lostDeals = publisherRecords
      .filter((record) => record.negotiationStatus === "rejected-over-budget")
      .map((record) => ({ domain: record.domain, reason: record.notes }));

    return { pipelineEntries, wonDeals: [...confirmedPlacements], lostDeals };
  }
}
