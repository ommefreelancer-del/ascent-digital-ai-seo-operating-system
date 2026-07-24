import { describe, expect, it } from "vitest";
import { ComplianceChecklistBuilder } from "../../../../src/agents/admin-agent/organizing/compliance-checklist-builder.js";
import type { CrmRecordUpdate } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { ClientProposalDraft } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeCrmUpdate(overrides: Partial<CrmRecordUpdate> = {}): CrmRecordUpdate {
  return { recordType: "client", action: "update", identifier: "acme.com", summary: "x", requiresApproval: true, ...overrides };
}

function makeProposal(overrides: Partial<ClientProposalDraft> = {}): ClientProposalDraft {
  return { domain: "acme.com", subject: "x", body: "x", requiresApproval: true, ...overrides };
}

describe("ComplianceChecklistBuilder", () => {
  const builder = new ComplianceChecklistBuilder();

  it("reports all three checks as met with clean, real data and supplied business requirements", () => {
    const checklist = builder.build([makeCrmUpdate()], [makeProposal()], "Grow revenue.");
    expect(checklist.every((item) => item.status === "met")).toBe(true);
    expect(checklist).toHaveLength(3);
  });

  it("reports the CRM check as met vacuously when there are no updates", () => {
    const checklist = builder.build([], [], null);
    const crmItem = checklist.find((item) => item.item.includes("CRM record update"));
    expect(crmItem?.status).toBe("met");
  });

  it("reports the CRM check as unmet when a real update is not marked requiresApproval", () => {
    const checklist = builder.build([makeCrmUpdate({ requiresApproval: false })], [], null);
    const crmItem = checklist.find((item) => item.item.includes("CRM record update"));
    expect(crmItem?.status).toBe("unmet");
  });

  it("reports the proposal check as unmet when a real proposal is not marked requiresApproval", () => {
    const checklist = builder.build([], [makeProposal({ requiresApproval: false })], null);
    const proposalItem = checklist.find((item) => item.item.includes("client proposal"));
    expect(proposalItem?.status).toBe("unmet");
  });

  it("reports the business requirements check as unmet when none were supplied", () => {
    const checklist = builder.build([], [], null);
    const requirementsItem = checklist.find((item) => item.item.includes("Business requirements"));
    expect(requirementsItem?.status).toBe("unmet");
  });

  it("reports the business requirements check as unmet when blank", () => {
    const checklist = builder.build([], [], "   ");
    const requirementsItem = checklist.find((item) => item.item.includes("Business requirements"));
    expect(requirementsItem?.status).toBe("unmet");
  });
});
