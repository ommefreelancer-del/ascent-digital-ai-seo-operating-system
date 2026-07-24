import { describe, expect, it } from "vitest";
import { NegotiationReplyDraftBuilder } from "../../../../src/agents/reply-negotiation-agent/negotiation/negotiation-reply-draft-builder.js";
import type { NegotiationRecommendation, TargetPricing } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

const TARGET_PRICING: TargetPricing = { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" };

function makeRecommendation(overrides: Partial<NegotiationRecommendation> = {}): NegotiationRecommendation {
  return { domain: "example.com", assessment: "within-target", recommendation: "x", rationale: "x", ...overrides };
}

describe("NegotiationReplyDraftBuilder", () => {
  const builder = new NegotiationReplyDraftBuilder();

  it("drafts a quote-request email when no real price was quoted", () => {
    const draft = builder.build(makeRecommendation({ assessment: "no-price-quoted" }), TARGET_PRICING, null, null);
    expect(draft.subject).toContain("pricing");
    expect(draft.body.toLowerCase()).toContain("specific price");
  });

  it("drafts a discount-request email referencing the real target price when negotiable", () => {
    const draft = builder.build(makeRecommendation({ assessment: "above-target-negotiable" }), TARGET_PRICING, null, null);
    expect(draft.subject).toBe("Discount request");
    expect(draft.body).toContain("$100");
  });

  it("includes the real business rules text when supplied", () => {
    const draft = builder.build(
      makeRecommendation({ assessment: "above-target-negotiable" }),
      TARGET_PRICING,
      "Never pay more than $150 for a dofollow link.",
      null,
    );
    expect(draft.body).toContain("Never pay more than $150 for a dofollow link.");
  });

  it("uses a bracketed placeholder signature when no sender name is supplied", () => {
    const draft = builder.build(makeRecommendation(), TARGET_PRICING, null, null);
    expect(draft.body).toContain("[Your Name]");
  });

  it("uses the real sender name when supplied", () => {
    const draft = builder.build(makeRecommendation(), TARGET_PRICING, null, "Jane Doe");
    expect(draft.body).toContain("Jane Doe");
  });

  it("always requires human approval", () => {
    const draft = builder.build(makeRecommendation({ assessment: "above-max-reject" }), TARGET_PRICING, null, null);
    expect(draft.requiresApproval).toBe(true);
  });
});
