// Category-by-category technical comparison, for exactly the 4 categories
// the Technical SEO Agent covers. "Ours" is the count of the Technical SEO
// Agent's own already-generated recommendations per category (real,
// already-computed); "theirs" is the count of non-info findings in the
// matching WebsiteAuditResult category from the competitor's real,
// freshly-computed audit.

import type { AuditedCompetitor } from "./audited-competitor.types.js";
import { TECHNICAL_CATEGORIES, TECHNICAL_TO_AUDIT_CATEGORY } from "./technical-categories.js";
import type {
  ComparisonAdvantage,
  CompetitorTechnicalComparison,
  TechnicalCategoryComparison,
} from "../types/competitor-intelligence-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";

function advantageOf(ourCount: number, competitorCount: number): ComparisonAdvantage {
  if (ourCount < competitorCount) {
    return "us";
  }
  if (ourCount > competitorCount) {
    return "competitor";
  }
  return "tie";
}

export class TechnicalComparisonBuilder {
  build(
    ourTechnicalSeo: TechnicalSeoResult,
    competitors: readonly AuditedCompetitor[],
  ): CompetitorTechnicalComparison[] {
    return competitors.map((competitor) => {
      const categories: TechnicalCategoryComparison[] = TECHNICAL_CATEGORIES.map((category) => {
        const ourIssueCount = ourTechnicalSeo.recommendations.filter((r) => r.category === category).length;
        const auditCategory = TECHNICAL_TO_AUDIT_CATEGORY[category];
        const competitorIssueCount = competitor.audit.findings.filter(
          (finding) => finding.category === auditCategory && finding.severity !== "info",
        ).length;
        return {
          category,
          ourIssueCount,
          competitorIssueCount,
          advantage: advantageOf(ourIssueCount, competitorIssueCount),
        };
      });

      return { competitorId: competitor.id, competitorUrl: competitor.url, categories };
    });
  }
}
