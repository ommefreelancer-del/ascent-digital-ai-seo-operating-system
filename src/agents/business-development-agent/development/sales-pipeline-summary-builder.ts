// Builds a real SalesPipelineSummary from the already-qualified lead
// report -- per the spec's "Track sales opportunities" responsibility.
// Plain counts over real, already-computed qualifications, never an
// invented figure.

import type { QualifiedLeadReportEntry, SalesPipelineSummary } from "../types/business-development-request.types.js";

export class SalesPipelineSummaryBuilder {
  build(qualifiedLeadReport: readonly QualifiedLeadReportEntry[]): SalesPipelineSummary {
    return {
      totalLeads: qualifiedLeadReport.length,
      qualifiedCount: qualifiedLeadReport.filter((lead) => lead.qualification === "qualified").length,
      earlyStageCount: qualifiedLeadReport.filter((lead) => lead.qualification === "early-stage").length,
      notQualifiedCount: qualifiedLeadReport.filter((lead) => lead.qualification === "not-qualified").length,
    };
  }
}
