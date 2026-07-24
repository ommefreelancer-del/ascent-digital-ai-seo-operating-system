// Consolidates real, already-computed client, prospect, and business
// opportunity data into a unified administrative record view -- per the
// spec's "Maintain internal records" responsibility. Every record traces to
// a real client status entry, a real qualified lead, or a real growth
// opportunity already computed by the AI CRM Agent or Business Development
// Agent -- this agent never invents a record.

import type { ClientStatusEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { GrowthOpportunity, QualifiedLeadReportEntry } from "../../business-development-agent/types/business-development-request.types.js";
import type { AdministrativeRecordEntry } from "../types/admin-request.types.js";

export class AdministrativeRecordBuilder {
  build(
    clientStatusReport: readonly ClientStatusEntry[],
    qualifiedLeadReport: readonly QualifiedLeadReportEntry[],
    growthOpportunities: readonly GrowthOpportunity[],
  ): AdministrativeRecordEntry[] {
    const clientRecords: AdministrativeRecordEntry[] = clientStatusReport.map((client) => ({
      recordType: "client",
      identifier: client.clientName,
      summary: `${client.status} (${client.activity})`,
    }));

    const prospectRecords: AdministrativeRecordEntry[] = qualifiedLeadReport
      .filter((lead) => lead.qualification === "qualified")
      .map((lead) => ({
        recordType: "prospect",
        identifier: lead.domain,
        summary: `${lead.stage} - ${lead.qualification}`,
      }));

    const opportunityRecords: AdministrativeRecordEntry[] = growthOpportunities.map((opportunity) => ({
      recordType: "business-opportunity",
      identifier: opportunity.category,
      summary: opportunity.description,
    }));

    return [...clientRecords, ...prospectRecords, ...opportunityRecords];
  }
}
