// Builds a real spreadsheet summary -- per the spec's "Generate spreadsheet
// summaries" responsibility. Plain counts over the real, already-built
// update proposals, never an invented figure.

import type { SheetUpdateProposal, SpreadsheetSummary } from "../types/google-sheets-integration-request.types.js";

export class SpreadsheetSummaryBuilder {
  build(sheetUpdateProposals: readonly SheetUpdateProposal[]): SpreadsheetSummary {
    return {
      totalProposedUpdates: sheetUpdateProposals.length,
      clientUpdateCount: sheetUpdateProposals.filter((p) => p.recordCategory === "client").length,
      publisherUpdateCount: sheetUpdateProposals.filter((p) => p.recordCategory === "publisher").length,
      pricingUpdateCount: sheetUpdateProposals.filter((p) => p.recordCategory === "pricing").length,
    };
  }
}
