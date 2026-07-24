import { describe, expect, it } from "vitest";
import { ClientProposalDraftBuilder } from "../../../../src/agents/business-development-agent/development/client-proposal-draft-builder.js";
import type {
  QualifiedLeadReportEntry,
  ServicePortfolioItem,
} from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeLead(overrides: Partial<QualifiedLeadReportEntry> = {}): QualifiedLeadReportEntry {
  return { domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "x", ...overrides };
}

function makeService(overrides: Partial<ServicePortfolioItem> = {}): ServicePortfolioItem {
  return { serviceName: "SEO Audit", description: "A full technical audit.", priceRangeLabel: "$500-$1,000", ...overrides };
}

describe("ClientProposalDraftBuilder", () => {
  const builder = new ClientProposalDraftBuilder();

  it("returns no proposals when the service portfolio is empty", () => {
    expect(builder.build([makeLead()], [], "Grow revenue.")).toEqual([]);
  });

  it("returns no proposals when there are no qualified leads", () => {
    const report = [makeLead({ qualification: "early-stage" }), makeLead({ domain: "b.com", qualification: "not-qualified" })];
    expect(builder.build(report, [makeService()], "Grow revenue.")).toEqual([]);
  });

  it("drafts one proposal per qualified lead, listing only real service portfolio items", () => {
    const report = [
      makeLead({ domain: "a.com", qualification: "qualified" }),
      makeLead({ domain: "b.com", qualification: "early-stage" }),
    ];
    const services = [makeService(), makeService({ serviceName: "Content Strategy", priceRangeLabel: "$1,200-$2,000" })];

    const proposals = builder.build(report, services, "Grow monthly recurring revenue.");

    expect(proposals).toHaveLength(1);
    const [draft] = proposals;
    expect(draft?.domain).toBe("a.com");
    expect(draft?.requiresApproval).toBe(true);
    expect(draft?.body).toContain("SEO Audit");
    expect(draft?.body).toContain("$500-$1,000");
    expect(draft?.body).toContain("Content Strategy");
    expect(draft?.body).toContain("Grow monthly recurring revenue.");
  });

  it("never invents a service or price beyond what was supplied", () => {
    const [draft] = builder.build([makeLead()], [makeService({ serviceName: "Link Building", priceRangeLabel: "$300-$600" })], "x");
    expect(draft?.body).not.toContain("SEO Audit");
    expect(draft?.body).toContain("Link Building");
    expect(draft?.body).toContain("$300-$600");
  });
});
