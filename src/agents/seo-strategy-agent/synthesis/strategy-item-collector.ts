// Collects every already-computed recommendation from the Technical SEO,
// On-Page SEO, Content Strategy, and Competitor Intelligence Agents into a
// single, uniformly-scored list. This agent does not re-derive any of these
// items from raw audit data -- each specialist agent already did that
// analysis; this is a synthesis pass over their real outputs only.
//
// Impact is the source agent's own already-assigned priority ("high" |
// "medium" | "low"), passed through unchanged -- never re-scored. The one
// exception is content gaps, which carry no priority field from the
// Content Strategy Agent; there, impact is derived from the real cluster
// size (more keywords in the gap = higher potential impact), the same
// "real, computable signal, not a fabricated one" principle used
// throughout this codebase (e.g. PillarStrategyBuilder's ranking).
//
// Effort is a stated, general category-based convention: crawlability,
// robots.txt, HTTPS, page-structure, and canonical fixes are typically
// configuration/markup changes (low effort); title/meta/heading/alt-text/
// internal-linking/structured-data/keyword-usage changes are typically
// content edits (medium effort); new content creation (content-gap) is
// high effort. This is a documented convention, not a claim about this
// specific business.
//
// confirmedBySources records which OTHER sources independently flagged an
// item in the same category -- cross-source agreement is real evidence
// (GLOBAL_RULES.md SS3), and factors into the priority score below.

import type {
  SeoStrategyRequest,
  StrategyEffort,
  StrategyImpact,
  StrategyItem,
} from "../types/seo-strategy-request.types.js";

const LOW_EFFORT_CATEGORIES = new Set(["crawlability", "robots-txt", "https", "page-structure", "canonical"]);
const HIGH_EFFORT_CATEGORIES = new Set(["content-gap"]);

function effortForCategory(category: string): StrategyEffort {
  if (LOW_EFFORT_CATEGORIES.has(category)) {
    return "low";
  }
  if (HIGH_EFFORT_CATEGORIES.has(category)) {
    return "high";
  }
  return "medium";
}

const IMPACT_POINTS: Record<StrategyImpact, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_PENALTY: Record<StrategyEffort, number> = { low: 0, medium: 0.5, high: 1 };
const CONFIRMATION_BONUS_PER_SOURCE = 0.5;

function computePriorityScore(impact: StrategyImpact, effort: StrategyEffort, confirmationCount: number): number {
  return IMPACT_POINTS[impact] - EFFORT_PENALTY[effort] + confirmationCount * CONFIRMATION_BONUS_PER_SOURCE;
}

interface RawItem {
  readonly source: string;
  readonly category: string;
  readonly description: string;
  readonly rationale: string;
  readonly impact: StrategyImpact;
}

const MIN_KEYWORDS_FOR_HIGH_IMPACT_GAP = 3;

export class StrategyItemCollector {
  collect(request: SeoStrategyRequest): StrategyItem[] {
    const raw: RawItem[] = [];

    for (const recommendation of request.technicalSeo.recommendations) {
      raw.push({
        source: "technical-seo",
        category: recommendation.category,
        description: recommendation.recommendation,
        rationale: recommendation.rationale,
        impact: recommendation.priority,
      });
    }

    if (request.onPageSeo) {
      for (const recommendation of request.onPageSeo.recommendations) {
        raw.push({
          source: "on-page-seo",
          category: recommendation.category,
          description: recommendation.recommendation,
          rationale: recommendation.rationale,
          impact: recommendation.priority,
        });
      }
    }

    if (request.contentStrategy) {
      for (const gap of request.contentStrategy.contentGaps) {
        raw.push({
          source: "content-strategy",
          category: "content-gap",
          description: `Create content for the "${gap.clusterLabel}" topic cluster (${gap.keywords.join(", ")}).`,
          rationale: gap.rationale,
          impact: gap.keywords.length >= MIN_KEYWORDS_FOR_HIGH_IMPACT_GAP ? "high" : "medium",
        });
      }
    }

    for (const recommendation of request.competitorIntelligence.recommendations) {
      raw.push({
        source: "competitor-intelligence",
        category: recommendation.category,
        description: recommendation.recommendation,
        rationale: recommendation.rationale,
        impact: recommendation.priority,
      });
    }

    const sourcesByCategory = new Map<string, Set<string>>();
    for (const item of raw) {
      const sources = sourcesByCategory.get(item.category) ?? new Set<string>();
      sources.add(item.source);
      sourcesByCategory.set(item.category, sources);
    }

    return raw.map((item, index) => {
      const sourcesForCategory = sourcesByCategory.get(item.category) ?? new Set<string>();
      const confirmedBySources = Array.from(sourcesForCategory).filter((source) => source !== item.source);
      const effort = effortForCategory(item.category);
      return {
        id: `${item.source}:${item.category}:${index}`,
        source: item.source,
        category: item.category,
        description: item.description,
        rationale: item.rationale,
        impact: item.impact,
        effort,
        confirmedBySources,
        priorityScore: computePriorityScore(item.impact, effort, confirmedBySources.length),
      };
    });
  }
}
