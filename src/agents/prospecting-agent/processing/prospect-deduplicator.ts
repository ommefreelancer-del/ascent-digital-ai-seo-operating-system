// Removes duplicate prospects by real domain (case-insensitive) -- per the
// spec's "Remove duplicate prospects" responsibility. When two real
// candidates share a domain, the one with the higher real relevance score
// is kept, since it is the more useful real signal; this is a deterministic
// tie-break, not a fabricated judgment.

import type { RawProspectCandidate } from "../types/prospect-discovery-provider.types.js";

export interface DeduplicationResult {
  readonly deduped: readonly RawProspectCandidate[];
  readonly duplicatesRemoved: number;
}

export class ProspectDeduplicator {
  dedupe(candidates: readonly RawProspectCandidate[]): DeduplicationResult {
    const byDomain = new Map<string, RawProspectCandidate>();

    for (const candidate of candidates) {
      const key = candidate.domain.toLowerCase();
      const existing = byDomain.get(key);
      if (!existing || candidate.relevanceScore > existing.relevanceScore) {
        byDomain.set(key, candidate);
      }
    }

    const deduped = Array.from(byDomain.values());
    return { deduped, duplicatesRemoved: candidates.length - deduped.length };
  }
}
