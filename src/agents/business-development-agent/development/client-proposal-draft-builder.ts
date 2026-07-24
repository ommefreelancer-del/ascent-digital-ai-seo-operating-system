// Drafts one service proposal per real qualified lead -- per the spec's
// "Prepare service proposals" and "Recommend pricing strategies"
// responsibilities. Every proposal references only real, caller-supplied
// service portfolio items and their real price range labels -- this agent
// never invents a service or a price, and never sends a proposal itself;
// every draft requires human approval per GLOBAL_RULES.md SS9.

import type {
  ClientProposalDraft,
  QualifiedLeadReportEntry,
  ServicePortfolioItem,
} from "../types/business-development-request.types.js";

export class ClientProposalDraftBuilder {
  build(
    qualifiedLeadReport: readonly QualifiedLeadReportEntry[],
    servicePortfolio: readonly ServicePortfolioItem[],
    businessGoals: string,
  ): ClientProposalDraft[] {
    if (servicePortfolio.length === 0) {
      return [];
    }

    const serviceList = servicePortfolio
      .map((item) => `- ${item.serviceName} (${item.priceRangeLabel}): ${item.description}`)
      .join("\n");

    return qualifiedLeadReport
      .filter((lead) => lead.qualification === "qualified")
      .map((lead) => ({
        domain: lead.domain,
        subject: "A proposal for working together",
        body:
          `Hi there,\n\nBased on our collaboration so far, we'd like to propose the following services:\n\n` +
          `${serviceList}\n\nThis aligns with our focus on: "${businessGoals}".\n\nLet us know if you'd like to ` +
          `discuss further.\n\nBest regards,\n[Your Name]`,
        requiresApproval: true,
      }));
  }
}
