// Builds a real data validation report -- per the spec's "Flag missing or
// inconsistent data" responsibility. Cross-checks two real, already-computed
// results against each other (a domain the Reply & Negotiation Agent marked
// "agreed-confirmed" should have a matching confirmed price) -- this is
// genuine consistency validation over real data, never a fabricated
// judgment.

import type { FinalAgreedPrice, NegotiationStatusEntry } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { DataValidationIssue } from "../types/google-sheets-integration-request.types.js";

export class DataValidationReportBuilder {
  build(negotiationStatusReport: readonly NegotiationStatusEntry[], finalAgreedPricing: readonly FinalAgreedPrice[]): DataValidationIssue[] {
    const confirmedDomains = new Set(finalAgreedPricing.map((price) => price.domain));

    return negotiationStatusReport
      .filter((status) => status.status === "agreed-confirmed" && !confirmedDomains.has(status.domain))
      .map((status) => ({
        identifier: status.domain,
        issue: "Marked agreed-confirmed but no confirmed price is recorded for this domain.",
      }));
  }
}
