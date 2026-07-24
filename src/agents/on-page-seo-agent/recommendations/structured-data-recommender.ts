// Recommends adding or fixing Schema.org structured data, and flags a
// featured-snippet opportunity for informational-intent pages -- both
// explicitly in this agent's own responsibilities ("Implement page-level
// structured data", "Identify featured snippet and rich result
// opportunities"). Only acts on the "page-structure" findings that actually
// concern structured data; doctype/lang/viewport findings from the same
// audit category belong to the Technical SEO Agent (see
// cross-functional-notes-builder.ts), not this recommender.

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";

export class StructuredDataRecommender implements OnPageRecommender {
  readonly category = "structured-data";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const recommendations: OnPageRecommendation[] = [];
    const structuredDataFindings = context.websiteAudit.findings.filter(
      (f) => f.category === "page-structure" && f.message.toLowerCase().includes("structured data"),
    );

    const missing = structuredDataFindings.find((f) => f.message.toLowerCase().includes("no structured data"));
    if (missing) {
      recommendations.push({
        category: "structured-data",
        priority: "low",
        recommendation:
          "Add relevant Schema.org structured data (e.g. Article, Product, or FAQPage depending on the " +
          "page's content) as a <script type=\"application/ld+json\"> block.",
        rationale: `Website audit flagged: ${missing.message}`,
      });
    }

    const invalid = structuredDataFindings.find((f) => f.message.toLowerCase().includes("invalid json"));
    if (invalid) {
      recommendations.push({
        category: "structured-data",
        priority: "medium",
        recommendation: "Fix the JSON syntax in the existing structured data block so it can be parsed.",
        rationale: `Website audit flagged: ${invalid.message}`,
      });
    }

    if (context.intent === "informational") {
      recommendations.push({
        category: "structured-data",
        priority: "low",
        recommendation:
          `Consider FAQPage or HowTo structured data for "${context.targetKeyword}" to target featured ` +
          "snippet and rich result opportunities, if the page's real content supports it.",
        rationale: "Informational intent pages are the most common candidates for featured snippets.",
      });
    }

    return recommendations;
  }
}
