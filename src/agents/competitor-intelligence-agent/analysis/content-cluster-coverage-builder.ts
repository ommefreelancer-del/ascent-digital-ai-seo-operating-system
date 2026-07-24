// Determines, for each of our real target keyword clusters, which supplied
// competitors' title/heading text appears to address it -- pure text-token
// overlap over real, caller-supplied HTML, the same deterministic technique
// used by ContentGapAnalyzer in the Content Strategy Agent. This does not
// (and cannot) determine whether *we* cover a cluster, since this agent has
// no raw body text for our own page -- only the competitor comparison is
// computed here; that limitation is stated explicitly by the facade.

import { extractHtmlFacts } from "../../website-audit-agent/parsing/html-fact-extractor.js";
import type { TopicCluster } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { CompetitorSnapshot, ContentClusterCoverage } from "../types/competitor-intelligence-request.types.js";

const MIN_TOKEN_LENGTH = 3;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= MIN_TOKEN_LENGTH));
}

function hasOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const token of a) {
    if (b.has(token)) {
      return true;
    }
  }
  return false;
}

export class ContentClusterCoverageBuilder {
  build(clusters: readonly TopicCluster[], competitors: readonly CompetitorSnapshot[]): ContentClusterCoverage[] {
    const competitorTokens = competitors.map((competitor) => {
      const facts = extractHtmlFacts(competitor.html);
      const text = [facts.title ?? "", ...facts.headings.map((heading) => heading.text)].join(" ");
      return { id: competitor.id, tokens: tokenize(text) };
    });

    return clusters.map((cluster) => {
      const clusterTokens = tokenize(cluster.keywords.join(" "));
      const coveredByCompetitors = competitorTokens
        .filter(({ tokens }) => hasOverlap(clusterTokens, tokens))
        .map(({ id }) => id);
      return { clusterLabel: cluster.label, keywords: cluster.keywords, coveredByCompetitors };
    });
  }
}
