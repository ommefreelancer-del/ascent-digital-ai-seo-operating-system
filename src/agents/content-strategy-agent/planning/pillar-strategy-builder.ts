// Builds the pillar-page / supporting-article strategy from content topic
// clusters, and ranks clusters by size (a real, computable signal -- how
// many supporting keywords a topic can support) rather than any fabricated
// popularity or value metric. If a real KeywordDataProvider is ever wired
// into the Keyword Research Agent, aggregate search volume would be a
// natural secondary ranking signal -- deliberately not attempted here since
// no such data is available in this build.

import type { ClassifiedKeyword, SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";
import type {
  ContentTopicCluster,
  PillarPageStrategyEntry,
  SupportingArticleBrief,
} from "../types/content-strategy-request.types.js";
import { capitalize } from "../util/capitalize.js";

function titleFor(keyword: string, intent: SearchIntent): string {
  switch (intent) {
    case "transactional":
      return `Buy ${capitalize(keyword)}: What to Know Before You Purchase`;
    case "commercial":
      return `${capitalize(keyword)}: Comparison and Buying Guide`;
    case "navigational":
      return `${capitalize(keyword)}: Everything You Need to Know`;
    case "informational":
    default:
      return `A Complete Guide to ${capitalize(keyword)}`;
  }
}

export class PillarStrategyBuilder {
  build(
    clusters: readonly ContentTopicCluster[],
    classifiedKeywords: readonly ClassifiedKeyword[],
  ): PillarPageStrategyEntry[] {
    const intentByKeyword = new Map(classifiedKeywords.map((k) => [k.keyword, k.intent]));
    const intentFor = (keyword: string): SearchIntent => intentByKeyword.get(keyword) ?? "informational";

    const unranked = clusters.map((cluster) => {
      const supportingArticles: SupportingArticleBrief[] = cluster.supportingKeywords.map((keyword) => ({
        keyword,
        intent: intentFor(keyword),
        suggestedTitle: titleFor(keyword, intentFor(keyword)),
      }));

      return {
        clusterLabel: cluster.label,
        pillarKeyword: cluster.pillarKeyword,
        pillarTitle: `The Complete Guide to ${capitalize(cluster.pillarKeyword)}`,
        pillarIntent: intentFor(cluster.pillarKeyword),
        supportingArticles,
        clusterSize: supportingArticles.length + 1,
      };
    });

    return unranked
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => b.entry.clusterSize - a.entry.clusterSize || a.index - b.index)
      .map(({ entry }, position): PillarPageStrategyEntry => ({
        clusterLabel: entry.clusterLabel,
        pillarKeyword: entry.pillarKeyword,
        pillarTitle: entry.pillarTitle,
        pillarIntent: entry.pillarIntent,
        supportingArticles: entry.supportingArticles,
        priorityRank: position + 1,
      }));
  }
}
