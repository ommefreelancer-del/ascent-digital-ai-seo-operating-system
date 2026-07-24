// Recommends internal links using a hub-and-spoke model: every pillar page
// links to each of its supporting articles, and every supporting article
// links back to its pillar. Purely structural, derived directly from the
// pillar strategy already built -- no external data involved.

import type { InternalLinkRecommendation, PillarPageStrategyEntry } from "../types/content-strategy-request.types.js";

export class InternalLinkingRecommender {
  build(pillarStrategy: readonly PillarPageStrategyEntry[]): InternalLinkRecommendation[] {
    const recommendations: InternalLinkRecommendation[] = [];

    for (const entry of pillarStrategy) {
      for (const supporting of entry.supportingArticles) {
        recommendations.push({
          fromTitle: entry.pillarTitle,
          toTitle: supporting.suggestedTitle,
          reason: `Pillar page should link to its supporting article targeting "${supporting.keyword}" to establish topical hierarchy.`,
        });
        recommendations.push({
          fromTitle: supporting.suggestedTitle,
          toTitle: entry.pillarTitle,
          reason: `Supporting article should link back to the pillar page for "${entry.pillarKeyword}" to consolidate topical authority.`,
        });
      }
    }

    return recommendations;
  }
}
