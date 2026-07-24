// Deterministic routing strategy: scores a candidate agent by how much of
// the task description's meaningful vocabulary overlaps with the terms the
// agent's own spec uses to describe its mission, responsibilities, inputs,
// and outputs. No external calls, no randomness, fully unit-testable, and
// every score comes with the exact matched terms as its rationale — which
// keeps the decision auditable and free of fabricated justification
// (GLOBAL_RULES.md SS2 Anti-Hallucination).

import type { AgentSpec } from "../types/agent-spec.types.js";
import type { RoutingCandidate } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";
import type { RoutingStrategy } from "./routing-strategy.js";

// A small, deliberately conservative stopword list: common English function
// words that carry no topical signal for matching SEO/marketing task
// descriptions against agent responsibilities.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "for", "yet",
  "of", "to", "in", "on", "at", "by", "with", "from", "into", "onto",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "this", "that", "these", "those", "it", "its", "as", "than", "then",
  "not", "no", "do", "does", "did", "doing",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "has", "have", "had", "having",
  "you", "your", "we", "our", "they", "them", "their", "he", "she", "his", "her",
  "all", "any", "each", "such", "very", "more", "most", "other",
  "about", "over", "under", "up", "down", "out", "off", "if",
]);

const MIN_TOKEN_LENGTH = 3;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

function toTermSet(texts: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      terms.add(token);
    }
  }
  return terms;
}

export class KeywordMatchRoutingStrategy implements RoutingStrategy {
  readonly name = "keyword-match";

  // AgentSpec objects are loaded once by AgentRegistry and reused for the
  // lifetime of the process, so their term sets never change -- caching by
  // object identity avoids re-tokenizing the same mission/responsibilities/
  // inputs/outputs on every single routed task.
  private readonly agentTermsCache = new WeakMap<AgentSpec, Set<string>>();

  score(task: TaskInput, candidate: AgentSpec): RoutingCandidate {
    const taskTerms = toTermSet([task.description]);
    const agentTerms = this.getAgentTerms(candidate);

    if (taskTerms.size === 0) {
      return {
        agentId: candidate.id,
        agentTitle: candidate.title,
        score: 0,
        matchedTerms: [],
      };
    }

    const matchedTerms = Array.from(taskTerms)
      .filter((term) => agentTerms.has(term))
      .sort();

    return {
      agentId: candidate.id,
      agentTitle: candidate.title,
      score: matchedTerms.length / taskTerms.size,
      matchedTerms,
    };
  }

  private getAgentTerms(candidate: AgentSpec): Set<string> {
    const cached = this.agentTermsCache.get(candidate);
    if (cached) {
      return cached;
    }
    const computed = toTermSet([
      candidate.mission,
      ...candidate.responsibilities,
      ...candidate.inputs,
      ...candidate.outputs,
    ]);
    this.agentTermsCache.set(candidate, computed);
    return computed;
  }
}
