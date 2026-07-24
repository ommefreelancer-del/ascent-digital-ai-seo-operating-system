// Compares real quoted terms against real, caller-supplied target pricing
// -- per the spec's "Compare quoted prices with target reseller pricing"
// and "Recommend negotiation strategies" responsibilities. Every
// assessment traces to a real comparison of real numbers; this builder
// never recommends accepting or rejecting a price it cannot verify.

import type { NegotiationRecommendation, QuotedTerms, TargetPricing } from "../types/reply-negotiation-request.types.js";

export class NegotiationRecommendationBuilder {
  build(quotedTerms: QuotedTerms, targetPricing: TargetPricing): NegotiationRecommendation {
    if (quotedTerms.status === "not-quoted" || quotedTerms.quotedPrice === null) {
      return {
        domain: quotedTerms.domain,
        assessment: "no-price-quoted",
        recommendation: "Request a specific price quote before proceeding.",
        rationale: "No real price was found in the publisher's reply text.",
      };
    }

    const { quotedPrice } = quotedTerms;
    const { targetPrice, maxAcceptablePrice, currency } = targetPricing;

    if (quotedPrice <= targetPrice) {
      return {
        domain: quotedTerms.domain,
        assessment: "within-target",
        recommendation: `Accept the quoted price of ${currency}${quotedPrice}, pending user confirmation.`,
        rationale: `Real quoted price ${currency}${quotedPrice} is at or below the real target price of ${currency}${targetPrice}.`,
      };
    }

    if (quotedPrice <= maxAcceptablePrice) {
      return {
        domain: quotedTerms.domain,
        assessment: "above-target-negotiable",
        recommendation: `Request a discount toward the target price of ${currency}${targetPrice}.`,
        rationale:
          `Real quoted price ${currency}${quotedPrice} exceeds the real target price of ${currency}${targetPrice} ` +
          `but remains within the real maximum acceptable price of ${currency}${maxAcceptablePrice}.`,
      };
    }

    return {
      domain: quotedTerms.domain,
      assessment: "above-max-reject",
      recommendation: `Decline or continue negotiating; the quoted price exceeds the maximum acceptable price of ${currency}${maxAcceptablePrice}.`,
      rationale: `Real quoted price ${currency}${quotedPrice} exceeds the real maximum acceptable price of ${currency}${maxAcceptablePrice}.`,
    };
  }
}
