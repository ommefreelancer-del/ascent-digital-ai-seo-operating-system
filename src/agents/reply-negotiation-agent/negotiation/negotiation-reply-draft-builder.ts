// Drafts one professional reply per real negotiation assessment -- per the
// spec's "Prepare reseller discount request emails" and "Generate
// follow-up negotiation emails" responsibilities. Every draft is a
// deterministic template over real data (domain, target pricing, and the
// real caller-supplied business rules, if any); this agent never sends a
// draft itself, per its own rule "never send emails without user
// approval."

import type { NegotiationRecommendation, NegotiationReplyDraft, TargetPricing } from "../types/reply-negotiation-request.types.js";

export class NegotiationReplyDraftBuilder {
  build(
    recommendation: NegotiationRecommendation,
    targetPricing: TargetPricing,
    businessRules: string | null,
    senderName: string | null,
  ): NegotiationReplyDraft {
    const signature = senderName ?? "[Your Name]";
    const rulesClause = businessRules ? ` This is guided by our internal policy: "${businessRules}".` : "";

    switch (recommendation.assessment) {
      case "no-price-quoted":
        return {
          domain: recommendation.domain,
          subject: "Following up on pricing",
          body:
            `Hi there,\n\nThanks for your reply. Could you share a specific price for this collaboration so we ` +
            `can move forward?\n\nBest regards,\n${signature}`,
          requiresApproval: true,
        };
      case "within-target":
        return {
          domain: recommendation.domain,
          subject: "Confirming details",
          body:
            `Hi there,\n\nThanks for the quote. That works for us -- we'd like to confirm and move forward at ` +
            `the quoted price, pending final internal sign-off.\n\nBest regards,\n${signature}`,
          requiresApproval: true,
        };
      case "above-target-negotiable":
        return {
          domain: recommendation.domain,
          subject: "Discount request",
          body:
            `Hi there,\n\nThanks for the quote. Our budget for this type of collaboration is ` +
            `${targetPricing.currency}${targetPricing.targetPrice}.${rulesClause} Would you be able to match ` +
            `that, or come close to it?\n\nBest regards,\n${signature}`,
          requiresApproval: true,
        };
      case "above-max-reject":
      default:
        return {
          domain: recommendation.domain,
          subject: "Following up",
          body:
            `Hi there,\n\nThanks for the quote. Unfortunately that's outside our budget for this collaboration ` +
            `(up to ${targetPricing.currency}${targetPricing.maxAcceptablePrice}).${rulesClause} Let us know if ` +
            `there's any flexibility, or we'll leave the door open for a future opportunity.\n\nBest regards,\n${signature}`,
          requiresApproval: true,
        };
    }
  }
}
