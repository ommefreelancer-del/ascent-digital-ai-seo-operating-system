// Builds a real NegotiationStatusEntry -- per the spec's own "Negotiation
// Status Report" output. Status reflects only real, already-computed
// signals: whether a real reply/price exists, the real negotiation
// assessment, and whether a human has actually confirmed the price as
// final (never inferred).

import type { NegotiationRecommendation, NegotiationStatus, NegotiationStatusEntry, QuotedTerms } from "../types/reply-negotiation-request.types.js";

export class NegotiationStatusBuilder {
  build(quotedTerms: QuotedTerms, recommendation: NegotiationRecommendation, isConfirmedAgreement: boolean): NegotiationStatusEntry {
    if (quotedTerms.status === "not-quoted") {
      return { domain: quotedTerms.domain, status: "awaiting-reply", notes: "No real price quote has been received yet." };
    }

    let status: NegotiationStatus;
    if (recommendation.assessment === "within-target") {
      status = isConfirmedAgreement ? "agreed-confirmed" : "agreed-pending-confirmation";
    } else if (recommendation.assessment === "above-max-reject") {
      status = "rejected-over-budget";
    } else {
      status = "negotiating";
    }

    return { domain: quotedTerms.domain, status, notes: recommendation.recommendation };
  }
}
