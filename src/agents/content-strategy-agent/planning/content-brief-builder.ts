// Builds a writing brief for every pillar page and supporting article.
// Section headings follow a standard, generic content-outline convention
// (not derived from any specific competitor's real content, which would
// require data this agent does not have). Word-count guidance is stated as
// a general industry-convention range and explicitly labeled as non-binding
// -- never presented as a guarantee of ranking or traffic, per
// GLOBAL_RULES.md SS6.

import type {
  ContentBrief,
  InternalLinkRecommendation,
  PillarPageStrategyEntry,
} from "../types/content-strategy-request.types.js";
import { capitalize } from "../util/capitalize.js";

const PILLAR_WORD_COUNT_GUIDANCE =
  "Recommended range: 1,800-3,000 words for pillar/cornerstone content (general industry convention, not a guarantee of ranking or traffic).";
const SUPPORTING_WORD_COUNT_GUIDANCE =
  "Recommended range: 800-1,500 words for supporting articles (general industry convention, not a guarantee of ranking or traffic).";

function sectionsFor(topic: string): string[] {
  const title = capitalize(topic);
  return [
    "Introduction",
    `What Is ${title}?`,
    `Benefits of ${title}`,
    `How to Get Started with ${title}`,
    "Frequently Asked Questions",
    "Conclusion",
  ];
}

export class ContentBriefBuilder {
  build(
    pillarStrategy: readonly PillarPageStrategyEntry[],
    internalLinks: readonly InternalLinkRecommendation[],
  ): ContentBrief[] {
    const linksFromTitle = new Map<string, string[]>();
    for (const link of internalLinks) {
      const list = linksFromTitle.get(link.fromTitle) ?? [];
      list.push(link.toTitle);
      linksFromTitle.set(link.fromTitle, list);
    }

    const briefs: ContentBrief[] = [];
    for (const entry of pillarStrategy) {
      briefs.push({
        title: entry.pillarTitle,
        contentType: "pillar",
        targetKeyword: entry.pillarKeyword,
        intent: entry.pillarIntent,
        clusterLabel: entry.clusterLabel,
        relatedKeywords: entry.supportingArticles.map((article) => article.keyword),
        recommendedSections: sectionsFor(entry.pillarKeyword),
        wordCountGuidance: PILLAR_WORD_COUNT_GUIDANCE,
        internalLinks: linksFromTitle.get(entry.pillarTitle) ?? [],
      });

      for (const supporting of entry.supportingArticles) {
        briefs.push({
          title: supporting.suggestedTitle,
          contentType: "supporting",
          targetKeyword: supporting.keyword,
          intent: supporting.intent,
          clusterLabel: entry.clusterLabel,
          relatedKeywords: [
            entry.pillarKeyword,
            ...entry.supportingArticles.map((article) => article.keyword).filter((k) => k !== supporting.keyword),
          ],
          recommendedSections: sectionsFor(supporting.keyword),
          wordCountGuidance: SUPPORTING_WORD_COUNT_GUIDANCE,
          internalLinks: linksFromTitle.get(supporting.suggestedTitle) ?? [],
        });
      }
    }

    return briefs;
  }
}
