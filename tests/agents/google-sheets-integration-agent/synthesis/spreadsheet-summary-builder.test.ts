import { describe, expect, it } from "vitest";
import { SpreadsheetSummaryBuilder } from "../../../../src/agents/google-sheets-integration-agent/synthesis/spreadsheet-summary-builder.js";
import type { SheetUpdateProposal } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";

function makeProposal(overrides: Partial<SheetUpdateProposal> = {}): SheetUpdateProposal {
  return { recordCategory: "client", action: "create", identifier: "acme.com", summary: "x", requiresApproval: true, ...overrides };
}

describe("SpreadsheetSummaryBuilder", () => {
  const builder = new SpreadsheetSummaryBuilder();

  it("returns all-zero counts for no proposals", () => {
    expect(builder.build([])).toEqual({ totalProposedUpdates: 0, clientUpdateCount: 0, publisherUpdateCount: 0, pricingUpdateCount: 0 });
  });

  it("counts each record category from real proposals", () => {
    const summary = builder.build([
      makeProposal({ recordCategory: "client" }),
      makeProposal({ recordCategory: "client" }),
      makeProposal({ recordCategory: "publisher" }),
      makeProposal({ recordCategory: "pricing" }),
      makeProposal({ recordCategory: "outreach-status" }),
    ]);

    expect(summary).toEqual({ totalProposedUpdates: 5, clientUpdateCount: 2, publisherUpdateCount: 1, pricingUpdateCount: 1 });
  });
});
