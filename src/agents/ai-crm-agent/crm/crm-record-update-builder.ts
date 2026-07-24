// Proposes real CRM record updates -- per the spec's "Manage client
// records" and "Manage prospect records" responsibilities. This build has
// no real CRM read integration, so it cannot determine whether a prospect
// record already exists -- every prospect update is honestly proposed as
// "create", never "update", since claiming otherwise would be a guess.
// Real, caller-supplied clients are proposed as "update" since the caller
// already identified them as existing. Per this agent's rule "never
// delete important records without approval", a deletion is never
// proposed at all in this build. Every proposal requires human approval
// before any real CRM write, per GLOBAL_RULES.md SS9.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { ReplyNegotiationResult } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { ClientInfoEntry, CrmRecordUpdate } from "../types/ai-crm-request.types.js";

export class CrmRecordUpdateBuilder {
  build(
    outreach: OutreachResult,
    replyNegotiation: ReplyNegotiationResult,
    clientInfo: readonly ClientInfoEntry[],
  ): CrmRecordUpdate[] {
    const updates: CrmRecordUpdate[] = [];

    const stageByDomain = new Map(replyNegotiation.negotiationStatusReport.map((entry) => [entry.domain, entry.status]));

    for (const status of outreach.outreachStatus) {
      const stage = stageByDomain.get(status.domain);
      const stageClause = stage ? ` Current pipeline stage: ${stage}.` : "";
      updates.push({
        recordType: "prospect",
        action: "create",
        identifier: status.domain,
        summary: `Record outreach activity for ${status.domain} (${status.status}).${stageClause}`,
        requiresApproval: true,
      });
    }

    for (const client of clientInfo) {
      updates.push({
        recordType: "client",
        action: "update",
        identifier: client.clientName,
        summary: `Update client record for ${client.clientName}: status "${client.status}", last contacted ${client.lastContactedAt}.`,
        requiresApproval: true,
      });
    }

    return updates;
  }
}
