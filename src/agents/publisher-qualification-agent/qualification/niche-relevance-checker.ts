// Deterministic, always-available niche relevance check -- per the spec's
// "Verify relevance to the target niche" responsibility. This never
// requires an external provider: it checks whether the real target niche
// text appears in the real prospect's own title or notes, already produced
// by the Prospecting Agent. This is a real, computable text-match signal,
// not a fabricated relevance judgment.

import type { Prospect } from "../../prospecting-agent/types/prospecting-request.types.js";

export function isNicheTextMatch(prospect: Prospect, targetNiche: string): boolean {
  const haystack = `${prospect.title} ${prospect.notes}`.toLowerCase();
  return haystack.includes(targetNiche.trim().toLowerCase());
}
