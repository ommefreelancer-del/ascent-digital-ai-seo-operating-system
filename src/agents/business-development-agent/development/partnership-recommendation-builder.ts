// Identifies partnership candidates from real, successfully confirmed
// negotiations only -- per the spec's "Support partnership opportunities"
// responsibility. A real, confirmed agreement is genuine evidence of a
// good-fit relationship worth deepening; this agent never recommends a
// partnership with a lead it has no real, positive signal for.

import type { QualifiedLeadReportEntry, PartnershipRecommendation } from "../types/business-development-request.types.js";

export class PartnershipRecommendationBuilder {
  build(qualifiedLeadReport: readonly QualifiedLeadReportEntry[]): PartnershipRecommendation[] {
    return qualifiedLeadReport
      .filter((lead) => lead.stage === "agreed-confirmed")
      .map((lead) => ({
        domain: lead.domain,
        recommendation: `Explore a deeper partnership with ${lead.domain} given the successfully confirmed collaboration.`,
        rationale: "Real, confirmed agreement from the Reply & Negotiation Agent (via the AI CRM Agent).",
      }));
  }
}
