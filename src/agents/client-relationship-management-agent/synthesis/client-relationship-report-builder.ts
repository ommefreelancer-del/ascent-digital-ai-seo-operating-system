// Builds the final real business report submitted to the Boss Agent -- per
// the spec's "Generate client relationship reports" responsibility. Plain
// counts over the real, already-computed client profiles, sales pipeline
// report, and financial summary; never an invented figure.

import type { ClientStatusEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { ClientRelationshipReport, FinancialSummary, SalesPipelineReport } from "../types/client-relationship-management-request.types.js";

export class ClientRelationshipReportBuilder {
  build(
    clientProfiles: readonly ClientStatusEntry[],
    salesPipelineReport: SalesPipelineReport,
    financialSummary: FinancialSummary,
  ): ClientRelationshipReport {
    return {
      totalClients: clientProfiles.length,
      activeClients: clientProfiles.filter((client) => client.activity === "active").length,
      inactiveClients: clientProfiles.filter((client) => client.activity === "inactive").length,
      pipelineCount: salesPipelineReport.pipelineEntries.length,
      wonDealCount: salesPipelineReport.wonDeals.length,
      lostDealCount: salesPipelineReport.lostDeals.length,
      outstandingInvoiceCount: financialSummary.outstandingInvoiceCount,
    };
  }
}
