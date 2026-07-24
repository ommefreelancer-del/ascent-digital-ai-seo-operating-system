// Synthesizes actionable recommendations from the technical comparison and
// content-cluster coverage already computed -- never from raw competitor
// text directly, and never by suggesting we copy a competitor's content
// (GLOBAL_RULES.md SS17: never copy competitor content). Recommendations
// only cite competitor ids and counts, never quote competitor copy.

import { TECHNICAL_CATEGORIES } from "./technical-categories.js";
import type {
  CompetitorActionableRecommendation,
  CompetitorTechnicalComparison,
  ContentClusterCoverage,
} from "../types/competitor-intelligence-request.types.js";

const MIN_COMPETITORS_FOR_CONTENT_SIGNAL = 2;

export class CompetitorRecommendationBuilder {
  build(
    technicalComparisons: readonly CompetitorTechnicalComparison[],
    contentCoverage: readonly ContentClusterCoverage[],
  ): CompetitorActionableRecommendation[] {
    const recommendations: CompetitorActionableRecommendation[] = [];

    for (const category of TECHNICAL_CATEGORIES) {
      const competitorsAhead = technicalComparisons
        .filter((comparison) => comparison.categories.some((c) => c.category === category && c.advantage === "competitor"))
        .map((comparison) => comparison.competitorId);

      if (competitorsAhead.length === 0) {
        continue;
      }

      recommendations.push({
        category,
        priority: "medium",
        recommendation:
          `Address ${category} issues to close the gap with competitor(s) ${competitorsAhead.join(", ")}, ` +
          "who show fewer issues in this category in their own audited page.",
        rationale: `${competitorsAhead.length} of the supplied competitor(s) have fewer ${category} issues than us.`,
      });
    }

    for (const coverage of contentCoverage) {
      if (coverage.coveredByCompetitors.length >= MIN_COMPETITORS_FOR_CONTENT_SIGNAL) {
        recommendations.push({
          category: "content-gap",
          priority: "medium",
          recommendation:
            `Prioritize content for the "${coverage.clusterLabel}" topic cluster -- multiple competitors ` +
            `(${coverage.coveredByCompetitors.join(", ")}) appear to address it in their own title/heading text.`,
          rationale:
            `${coverage.coveredByCompetitors.length} of the supplied competitors have title/heading text ` +
            "overlapping this cluster's keywords.",
        });
      }
    }

    return recommendations;
  }
}
