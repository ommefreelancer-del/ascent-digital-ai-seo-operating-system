// Identifies growth opportunities from real, already-computed data only --
// per the spec's "Monitor business growth trends" responsibility.
// Reactivation opportunities trace to real inactive clients the AI CRM
// Agent already flagged; pipeline opportunities trace to the real sales
// pipeline summary; market opportunities only ever echo the caller's own
// real, supplied market research text -- this agent never performs its own
// market research or invents a trend.

import type { ClientStatusEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { GrowthOpportunity, SalesPipelineSummary } from "../types/business-development-request.types.js";

export class GrowthOpportunityBuilder {
  build(
    clientStatusReport: readonly ClientStatusEntry[],
    pipelineSummary: SalesPipelineSummary,
    marketResearch: string | null,
  ): GrowthOpportunity[] {
    const opportunities: GrowthOpportunity[] = [];

    for (const client of clientStatusReport) {
      if (client.activity === "inactive") {
        opportunities.push({
          category: "reactivation",
          description: `Reconsider outreach to ${client.clientName}, inactive since ${client.lastContactedAt}.`,
          rationale: "Real, already-computed client activity status from the AI CRM Agent.",
        });
      }
    }

    if (pipelineSummary.totalLeads === 0) {
      opportunities.push({
        category: "pipeline",
        description: "No real leads are currently in the sales pipeline.",
        rationale: "The real CRM lead pipeline is empty.",
      });
    } else if (pipelineSummary.qualifiedCount === 0) {
      opportunities.push({
        category: "pipeline",
        description: "No leads are currently qualified; consider revisiting outreach targeting.",
        rationale: `Real pipeline data shows 0 of ${pipelineSummary.totalLeads} lead(s) qualified.`,
      });
    }

    if (marketResearch) {
      opportunities.push({
        category: "market",
        description: marketResearch,
        rationale: "Caller-supplied real market research.",
      });
    }

    return opportunities;
  }
}
