// Builds a real compliance checklist -- per the spec's "Support compliance
// and operational processes" responsibility. Every item is a deterministic
// check of an already-real invariant (e.g. "every CRM record update
// requires human approval") -- this agent never invents a compliance
// judgment or a fabricated audit finding.

import type { CrmRecordUpdate } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { ClientProposalDraft } from "../../business-development-agent/types/business-development-request.types.js";
import type { ComplianceChecklistItem } from "../types/admin-request.types.js";

export class ComplianceChecklistBuilder {
  build(
    crmRecordUpdates: readonly CrmRecordUpdate[],
    clientProposals: readonly ClientProposalDraft[],
    businessRequirements: string | null,
  ): ComplianceChecklistItem[] {
    const items: ComplianceChecklistItem[] = [];

    const crmUpdatesRequireApproval = crmRecordUpdates.every((update) => update.requiresApproval);
    items.push({
      item: "Every proposed CRM record update requires human approval before being applied.",
      status: crmUpdatesRequireApproval ? "met" : "unmet",
      note: crmUpdatesRequireApproval
        ? `All ${crmRecordUpdates.length} real proposed CRM record update(s) are marked requiresApproval.`
        : "At least one proposed CRM record update is not marked requiresApproval.",
    });

    const proposalsRequireApproval = clientProposals.every((proposal) => proposal.requiresApproval);
    items.push({
      item: "Every client proposal draft requires human approval before being sent.",
      status: proposalsRequireApproval ? "met" : "unmet",
      note: proposalsRequireApproval
        ? `All ${clientProposals.length} real client proposal draft(s) are marked requiresApproval.`
        : "At least one client proposal draft is not marked requiresApproval.",
    });

    const hasBusinessRequirements = businessRequirements !== null && businessRequirements.trim().length > 0;
    items.push({
      item: "Business requirements are documented for this administrative review.",
      status: hasBusinessRequirements ? "met" : "unmet",
      note: hasBusinessRequirements
        ? "Real business requirements were supplied."
        : "No business requirements were supplied for this administrative review.",
    });

    return items;
  }
}
