import { describe, expect, it } from "vitest";
import { LeadQualifier } from "../../../../src/agents/business-development-agent/development/lead-qualifier.js";
import type { LeadPipelineEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { NegotiationStatus } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeLead(stage: NegotiationStatus, overrides: Partial<LeadPipelineEntry> = {}): LeadPipelineEntry {
  return { domain: "example.com", stage, notes: "Real note.", ...overrides };
}

describe("LeadQualifier", () => {
  const qualifier = new LeadQualifier();

  it("returns an empty report for an empty pipeline", () => {
    expect(qualifier.build([])).toEqual([]);
  });

  it.each<[NegotiationStatus, string]>([
    ["agreed-confirmed", "qualified"],
    ["agreed-pending-confirmation", "qualified"],
    ["negotiating", "qualified"],
    ["awaiting-reply", "early-stage"],
    ["rejected-over-budget", "not-qualified"],
  ])("maps stage %s to qualification %s", (stage, expected) => {
    const [entry] = qualifier.build([makeLead(stage)]);
    expect(entry?.qualification).toBe(expected);
  });

  it("carries forward the real domain, stage, and notes unchanged", () => {
    const [entry] = qualifier.build([makeLead("negotiating", { domain: "acme.com", notes: "Awaiting final terms." })]);
    expect(entry).toEqual({ domain: "acme.com", stage: "negotiating", qualification: "qualified", notes: "Awaiting final terms." });
  });

  it("qualifies every real lead in a multi-entry pipeline independently", () => {
    const report = qualifier.build([makeLead("agreed-confirmed", { domain: "a.com" }), makeLead("awaiting-reply", { domain: "b.com" })]);
    expect(report).toHaveLength(2);
    expect(report[0]?.qualification).toBe("qualified");
    expect(report[1]?.qualification).toBe("early-stage");
  });
});
