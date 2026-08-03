// A second, deterministic RoutingStrategy that blends the existing
// keyword-overlap signal (mission/responsibilities/inputs/outputs vocabulary,
// exactly as KeywordMatchRoutingStrategy computes it) with an explicit
// tags/capabilities signal from each agent's optional "## Tags" and
// "## Capabilities" spec sections. This is the pluggable second strategy
// routing-strategy.ts's own comment anticipates -- it does not modify
// TaskRouter or KeywordMatchRoutingStrategy.
//
// Tags and capabilities are deliberately curated by whoever wrote the spec
// (unlike mission/responsibilities prose, which is written to be read, not
// matched against), so a match there is weighted more heavily. But an agent
// that declares no tags/capabilities must route EXACTLY as it did under
// KeywordMatchRoutingStrategy -- falling back to keyword-only scoring for
// that agent -- so specs that haven't been annotated yet (most of the 28)
// see no regression in routing quality.
//
// Term-rarity (IDF) weighting: real routing tests against the live registry
// found that short, common-vocabulary requests ("Write a blog about
// Technical SEO.") lost to agents that only shared generic, widely-used
// words ("technical", "seo" -- present in a third of all specs) while the
// one agent whose spec actually says "blog" (df=1 across all 27 specs)
// wasn't even in the top candidates -- a plain match-count ratio treats a
// generic word and a decisive one identically. When constructed with the
// real candidate corpus, this strategy now weights each matched term by
// how rare it is across that corpus (a standard smoothed IDF), so a unique,
// decisive term outweighs several generic ones shared by many agents.
// Constructed with no corpus (every existing unit test in
// tests/boss-agent/routing/tag-weighted-routing-strategy.test.ts, which
// scores one synthetic candidate in isolation with no registry context),
// every term gets equal weight 1 -- algebraically identical to the
// original ratio formula, so none of those tests needed to change.

import type { AgentSpec } from "../types/agent-spec.types.js";
import type { RoutingCandidate } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";
import type { RoutingStrategy } from "./routing-strategy.js";
import { toTermSet } from "./keyword-match-routing-strategy.js";

const KEYWORD_WEIGHT = 0.4;
const TAG_WEIGHT = 0.6;

// REGRESSION: a real, live test found "Generate content for my Services
// page." routing to website-audit-agent (score 0.88) instead of
// seo-content-agent (0.59) -- website-audit-agent's spec incidentally uses
// "generate" ("Generate a prioritized audit report"), "content" ("duplicate
// content"), and "page" ("page performance") in senses that have nothing to
// do with authoring content, and the plain term-overlap ratio can't tell the
// difference. Content-authoring intent is only real when an authoring VERB
// and a content-type NOUN appear together -- e.g. "generate content", "write
// a blog", "create an article" -- not from either word alone, since a bare
// verb like "generate" or "write" is common across many unrelated specs
// ("Generate a guest post." legitimately belongs to
// guest-posting-digital-pr-agent, which has its own specific "guest"/"post"
// vocabulary; requiring the noun pairing here leaves that routing untouched).
// When the pairing is present, seo-content-agent's score is set to the
// maximum (1) -- matchedTerms stays exactly what was actually matched, so
// the rationale never claims a term wasn't really present (GLOBAL_RULES.md
// SS2 Anti-Hallucination); only the numeric score is overridden.
const CONTENT_AUTHORING_VERBS = new Set(["write", "create", "generate", "draft"]);
const CONTENT_AUTHORING_NOUNS = new Set(["article", "blog", "content"]);
const CONTENT_AGENT_ID = "seo-content-agent";

function hasContentAuthoringIntent(taskTerms: ReadonlySet<string>): boolean {
  let hasVerb = false;
  let hasNoun = false;
  for (const term of taskTerms) {
    if (CONTENT_AUTHORING_VERBS.has(term)) hasVerb = true;
    if (CONTENT_AUTHORING_NOUNS.has(term)) hasNoun = true;
    if (hasVerb && hasNoun) return true;
  }
  return false;
}

export class TagWeightedRoutingStrategy implements RoutingStrategy {
  readonly name = "tag-weighted";

  // AgentSpec objects are loaded once by AgentRegistry and reused for the
  // process lifetime -- caching by object identity avoids re-tokenizing the
  // same spec text on every routed task, matching KeywordMatchRoutingStrategy's
  // own caching approach.
  private readonly keywordTermsCache = new WeakMap<AgentSpec, Set<string>>();
  private readonly tagTermsCache = new WeakMap<AgentSpec, Set<string>>();
  private readonly keywordIdf: ReadonlyMap<string, number> | null;
  private readonly tagIdf: ReadonlyMap<string, number> | null;

  /** `candidates`: the full registry, so real corpus-wide term rarity can be computed once. Omit to get the original, unweighted ratio formula (used by isolated single-candidate unit tests). */
  constructor(candidates?: readonly AgentSpec[]) {
    if (candidates && candidates.length > 0) {
      this.keywordIdf = this.computeIdf(candidates, (c) => this.getKeywordTerms(c));
      this.tagIdf = this.computeIdf(candidates, (c) => this.getTagTerms(c));
    } else {
      this.keywordIdf = null;
      this.tagIdf = null;
    }
  }

  score(task: TaskInput, candidate: AgentSpec): RoutingCandidate {
    const taskTerms = toTermSet([task.description]);
    if (taskTerms.size === 0) {
      return { agentId: candidate.id, agentTitle: candidate.title, score: 0, matchedTerms: [] };
    }

    const contentAuthoringIntent = candidate.id === CONTENT_AGENT_ID && hasContentAuthoringIntent(taskTerms);

    const keywordTerms = this.getKeywordTerms(candidate);
    const matchedKeywordTerms = new Set(Array.from(taskTerms).filter((term) => keywordTerms.has(term)));
    const keywordScore = this.weightedRatio(matchedKeywordTerms, taskTerms, this.keywordIdf);

    const tagTerms = this.getTagTerms(candidate);
    if (tagTerms.size === 0) {
      // No curated signal declared for this agent -- behave identically to
      // KeywordMatchRoutingStrategy rather than diluting its score with an
      // always-zero tag component.
      return {
        agentId: candidate.id,
        agentTitle: candidate.title,
        score: contentAuthoringIntent ? 1 : keywordScore,
        matchedTerms: Array.from(matchedKeywordTerms).sort(),
      };
    }

    const matchedTagTerms = new Set(Array.from(taskTerms).filter((term) => tagTerms.has(term)));
    const tagScore = this.weightedRatio(matchedTagTerms, taskTerms, this.tagIdf);

    const combinedScore = contentAuthoringIntent ? 1 : Math.min(1, KEYWORD_WEIGHT * keywordScore + TAG_WEIGHT * tagScore);
    const matchedTerms = Array.from(new Set([...matchedKeywordTerms, ...matchedTagTerms])).sort();

    return { agentId: candidate.id, agentTitle: candidate.title, score: combinedScore, matchedTerms };
  }

  /** Smoothed IDF (`ln((N+1)/(df+1)) + 1`): common terms shrink toward a low positive weight rather than a fabricated zero, rare terms (small df) get a high weight. Never negative or zero, so a matched-but-universal term still counts a little. */
  private computeIdf(candidates: readonly AgentSpec[], termsOf: (c: AgentSpec) => Set<string>): Map<string, number> {
    const documentFrequency = new Map<string, number>();
    for (const c of candidates) {
      for (const term of termsOf(c)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
    const n = candidates.length;
    const idf = new Map<string, number>();
    for (const [term, df] of documentFrequency) {
      idf.set(term, Math.log((n + 1) / (df + 1)) + 1);
    }
    return idf;
  }

  private weightedRatio(matched: ReadonlySet<string>, taskTerms: ReadonlySet<string>, idf: ReadonlyMap<string, number> | null): number {
    let numerator = 0;
    let denominator = 0;
    for (const term of taskTerms) {
      const weight = idf ? (idf.get(term) ?? 1) : 1;
      denominator += weight;
      if (matched.has(term)) numerator += weight;
    }
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private getKeywordTerms(candidate: AgentSpec): Set<string> {
    const cached = this.keywordTermsCache.get(candidate);
    if (cached) return cached;
    const computed = toTermSet([candidate.mission, ...candidate.responsibilities, ...candidate.inputs, ...candidate.outputs]);
    this.keywordTermsCache.set(candidate, computed);
    return computed;
  }

  private getTagTerms(candidate: AgentSpec): Set<string> {
    const cached = this.tagTermsCache.get(candidate);
    if (cached) return cached;
    const computed = toTermSet([...candidate.tags, ...candidate.capabilities]);
    this.tagTermsCache.set(candidate, computed);
    return computed;
  }
}
