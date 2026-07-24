// Builds a real QualifiedLeadReportEntry per real lead in the AI CRM
// Agent's own lead pipeline -- per the spec's "Qualify inbound and
// outbound leads" responsibility. Qualification is a documented,
// deterministic mapping from the real negotiation stage the Reply &
// Negotiation Agent already computed (via the AI CRM Agent) -- a stated
// convention, not a fabricated judgment, consistent with how other agents
// in this codebase state their own category conventions (e.g. effort
// categories, confidence thresholds).

import type { LeadPipelineEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { NegotiationStatus } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { LeadQualification, QualifiedLeadReportEntry } from "../types/business-development-request.types.js";

const QUALIFICATION_BY_STAGE: Record<NegotiationStatus, LeadQualification> = {
  "agreed-confirmed": "qualified",
  "agreed-pending-confirmation": "qualified",
  negotiating: "qualified",
  "awaiting-reply": "early-stage",
  "rejected-over-budget": "not-qualified",
};

export class LeadQualifier {
  build(leadPipeline: readonly LeadPipelineEntry[]): QualifiedLeadReportEntry[] {
    return leadPipeline.map((lead) => ({
      domain: lead.domain,
      stage: lead.stage,
      qualification: QUALIFICATION_BY_STAGE[lead.stage],
      notes: lead.notes,
    }));
  }
}
