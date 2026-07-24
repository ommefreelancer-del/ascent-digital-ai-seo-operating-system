// Builds the final Prospect list from real, deduplicated candidates --
// per the spec's "Categorize prospects" and "Assign a confidence level"
// responsibilities. Category is the provider's own real classification,
// passed through unchanged. Confidence is a deterministic mapping from the
// provider's own real relevance score against documented thresholds (0.7+
// high, 0.4+ medium, else low) -- a stated convention, not a fabricated
// judgment, consistent with how other agents in this codebase state their
// own thresholds (e.g. Core Web Vitals "good" thresholds).

import type { ConfidenceLevel, Prospect } from "../types/prospecting-request.types.js";
import type { RawProspectCandidate } from "../types/prospect-discovery-provider.types.js";

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.4;

function confidenceFor(relevanceScore: number): ConfidenceLevel {
  if (relevanceScore >= HIGH_CONFIDENCE_THRESHOLD) {
    return "high";
  }
  if (relevanceScore >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return "medium";
  }
  return "low";
}

export class ProspectBuilder {
  build(candidates: readonly RawProspectCandidate[]): Prospect[] {
    return candidates.map((candidate) => ({
      url: candidate.url,
      domain: candidate.domain,
      title: candidate.title,
      category: candidate.opportunityType,
      confidence: confidenceFor(candidate.relevanceScore),
      notes: `"${candidate.title}" -- ${candidate.snippet} (relevance score: ${candidate.relevanceScore}).`,
    }));
  }
}
