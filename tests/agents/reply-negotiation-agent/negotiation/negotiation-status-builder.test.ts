import { describe, expect, it } from "vitest";
import { NegotiationStatusBuilder } from "../../../../src/agents/reply-negotiation-agent/negotiation/negotiation-status-builder.js";
import type { NegotiationRecommendation, QuotedTerms } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeQuotedTerms(overrides: Partial<QuotedTerms> = {}): QuotedTerms {
  return { domain: "example.com", status: "quoted", quotedPrice: 100, rawQuoteText: "x", ...overrides };
}

function makeRecommendation(overrides: Partial<NegotiationRecommendation> = {}): NegotiationRecommendation {
  return { domain: "example.com", assessment: "within-target", recommendation: "Accept.", rationale: "x", ...overrides };
}

describe("NegotiationStatusBuilder", () => {
  const builder = new NegotiationStatusBuilder();

  it("reports awaiting-reply when no real quote exists", () => {
    const status = builder.build(makeQuotedTerms({ status: "not-quoted", quotedPrice: null }), makeRecommendation({ assessment: "no-price-quoted" }), false);
    expect(status.status).toBe("awaiting-reply");
  });

  it("reports agreed-pending-confirmation when within target but not yet confirmed", () => {
    const status = builder.build(makeQuotedTerms(), makeRecommendation(), false);
    expect(status.status).toBe("agreed-pending-confirmation");
  });

  it("reports agreed-confirmed when within target and a human confirmed it", () => {
    const status = builder.build(makeQuotedTerms(), makeRecommendation(), true);
    expect(status.status).toBe("agreed-confirmed");
  });

  it("reports rejected-over-budget when the real price exceeds the max", () => {
    const status = builder.build(makeQuotedTerms(), makeRecommendation({ assessment: "above-max-reject" }), false);
    expect(status.status).toBe("rejected-over-budget");
  });

  it("reports negotiating when above target but still negotiable", () => {
    const status = builder.build(makeQuotedTerms(), makeRecommendation({ assessment: "above-target-negotiable" }), false);
    expect(status.status).toBe("negotiating");
  });
});
