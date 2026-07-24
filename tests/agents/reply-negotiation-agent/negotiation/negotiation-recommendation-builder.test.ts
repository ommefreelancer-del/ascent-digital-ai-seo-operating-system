import { describe, expect, it } from "vitest";
import { NegotiationRecommendationBuilder } from "../../../../src/agents/reply-negotiation-agent/negotiation/negotiation-recommendation-builder.js";
import type { QuotedTerms, TargetPricing } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

const TARGET_PRICING: TargetPricing = { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" };

function makeQuotedTerms(overrides: Partial<QuotedTerms> = {}): QuotedTerms {
  return { domain: "example.com", status: "quoted", quotedPrice: 100, rawQuoteText: "x", ...overrides };
}

describe("NegotiationRecommendationBuilder", () => {
  const builder = new NegotiationRecommendationBuilder();

  it("recommends requesting a quote when no real price was found", () => {
    const recommendation = builder.build(makeQuotedTerms({ status: "not-quoted", quotedPrice: null }), TARGET_PRICING);
    expect(recommendation.assessment).toBe("no-price-quoted");
  });

  it("recommends accepting when the real quoted price is at or below the real target", () => {
    const atTarget = builder.build(makeQuotedTerms({ quotedPrice: 100 }), TARGET_PRICING);
    const belowTarget = builder.build(makeQuotedTerms({ quotedPrice: 80 }), TARGET_PRICING);
    expect(atTarget.assessment).toBe("within-target");
    expect(belowTarget.assessment).toBe("within-target");
  });

  it("recommends negotiating when the real quoted price is above target but within the real max", () => {
    const recommendation = builder.build(makeQuotedTerms({ quotedPrice: 120 }), TARGET_PRICING);
    expect(recommendation.assessment).toBe("above-target-negotiable");
  });

  it("recommends rejecting or continuing to negotiate when the real quoted price exceeds the real max", () => {
    const recommendation = builder.build(makeQuotedTerms({ quotedPrice: 200 }), TARGET_PRICING);
    expect(recommendation.assessment).toBe("above-max-reject");
  });

  it("includes the real numbers in the rationale", () => {
    const recommendation = builder.build(makeQuotedTerms({ quotedPrice: 120 }), TARGET_PRICING);
    expect(recommendation.rationale).toContain("120");
    expect(recommendation.rationale).toContain("100");
  });
});
