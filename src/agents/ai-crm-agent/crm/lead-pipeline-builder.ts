// Builds the real lead pipeline -- per the spec's "Track leads through the
// sales pipeline" responsibility. Every entry relays the Reply &
// Negotiation Agent's own real, already-computed negotiation status;
// this builder never re-derives or guesses a pipeline stage.

import type { ReplyNegotiationResult } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { LeadPipelineEntry } from "../types/ai-crm-request.types.js";

export class LeadPipelineBuilder {
  build(replyNegotiation: ReplyNegotiationResult): LeadPipelineEntry[] {
    return replyNegotiation.negotiationStatusReport.map((entry) => ({
      domain: entry.domain,
      stage: entry.status,
      notes: entry.notes,
    }));
  }
}
