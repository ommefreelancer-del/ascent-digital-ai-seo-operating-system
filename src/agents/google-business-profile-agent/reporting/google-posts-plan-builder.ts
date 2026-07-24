// Drafts Google Post ideas for a human to review and publish -- this agent
// never publishes a post itself. Drafts are deterministic templates tied to
// the real business name (and the real, caller-supplied local SEO strategy
// text, if any), with bracketed placeholders for anything only a human can
// supply (an actual offer, event, or testimonial) -- never a fabricated
// promotion.

import type { GooglePostSuggestion } from "../types/google-business-profile-request.types.js";

export class GooglePostsPlanBuilder {
  build(businessName: string, localSeoStrategy: string | undefined): GooglePostSuggestion[] {
    const posts: GooglePostSuggestion[] = [
      {
        topic: "Business Update",
        draftText: `Share a recent update about ${businessName}. [Add the specific news, offer, or event details.]`,
        requiresApproval: true,
      },
      {
        topic: "Customer Engagement",
        draftText:
          `Highlight what makes ${businessName} stand out for customers. [Add a specific differentiator or a ` +
          "real customer testimonial with permission.]",
        requiresApproval: true,
      },
    ];

    if (localSeoStrategy) {
      posts.push({
        topic: "Local SEO Strategy Alignment",
        draftText: `Align a Google Post with the supplied local SEO strategy: "${localSeoStrategy}". [Add specific content details.]`,
        requiresApproval: true,
      });
    }

    return posts;
  }
}
