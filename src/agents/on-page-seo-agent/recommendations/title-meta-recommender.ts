// Recommends a title tag and/or meta description only when the Website
// Audit Agent actually flagged a problem with them -- this agent never
// claims to know the current text of a title/description the audit didn't
// report as an issue. Suggested copy is a deterministic template tied to
// the target keyword's real classified intent, with bracketed placeholders
// for anything this agent cannot know (brand name, specific offers) --
// never invented, and never a final, ready-to-publish rewrite (no LLM is
// used to produce this).

import type { SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";
import { capitalize } from "../util/capitalize.js";

function suggestTitle(keyword: string, intent: SearchIntent): string {
  const term = capitalize(keyword);
  switch (intent) {
    case "transactional":
      return `Buy ${term} | [Your Brand]`;
    case "commercial":
      return `Best ${term}: Comparison Guide | [Your Brand]`;
    case "navigational":
      return `${term} | [Your Brand] Official Page`;
    case "informational":
    default:
      return `${term}: The Complete Guide | [Your Brand]`;
  }
}

function suggestMetaDescription(keyword: string, intent: SearchIntent): string {
  const term = keyword;
  switch (intent) {
    case "transactional":
      return `Shop ${term} today. [Add your unique value proposition -- pricing, shipping, or guarantees.]`;
    case "commercial":
      return `Compare the best options for ${term}. [Add what makes your recommendation trustworthy.]`;
    case "navigational":
      return `Official information about ${term}. [Add what a visitor will find here.]`;
    case "informational":
    default:
      return `Learn everything about ${term} in this complete guide. [Add your specific angle or expertise.]`;
  }
}

export class TitleMetaRecommender implements OnPageRecommender {
  readonly category = "title-meta";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const recommendations: OnPageRecommendation[] = [];
    const metadataFindings = context.websiteAudit.findings.filter((f) => f.category === "metadata");

    const titleFinding = metadataFindings.find((f) => f.message.toLowerCase().includes("title"));
    if (titleFinding) {
      recommendations.push({
        category: "title-tag",
        priority: titleFinding.severity === "critical" ? "high" : "medium",
        recommendation: `Consider a title such as: "${suggestTitle(context.targetKeyword, context.intent)}".`,
        rationale: `Website audit flagged: ${titleFinding.message}`,
      });
    }

    const descriptionFinding = metadataFindings.find((f) => f.message.toLowerCase().includes("description"));
    if (descriptionFinding) {
      recommendations.push({
        category: "meta-description",
        priority: descriptionFinding.severity === "critical" ? "high" : "medium",
        recommendation: `Consider a meta description such as: "${suggestMetaDescription(context.targetKeyword, context.intent)}".`,
        rationale: `Website audit flagged: ${descriptionFinding.message}`,
      });
    }

    return recommendations;
  }
}
