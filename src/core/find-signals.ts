// Shared signal-detection primitive used by every agent validator that
// scans free-text input for policy-risk, destructive-action, or
// prompt-injection terms (see GLOBAL_RULES.md SS6/SS9/SS13). Each caller
// supplies its own haystack and its own list of patterns/labels reflecting
// its own rules -- only the match-and-dedupe loop itself is shared.

export interface SignalPattern {
  readonly pattern: RegExp;
  readonly label: string;
}

/**
 * Returns the labels of every pattern that matches `haystack`, each label
 * appearing at most once, in pattern-list order. Never throws -- an empty
 * array means no signal was found.
 */
export function findSignals(haystack: string, patterns: readonly SignalPattern[]): string[] {
  const matches: string[] = [];
  for (const { pattern, label } of patterns) {
    if (pattern.test(haystack) && !matches.includes(label)) {
      matches.push(label);
    }
  }
  return matches;
}
