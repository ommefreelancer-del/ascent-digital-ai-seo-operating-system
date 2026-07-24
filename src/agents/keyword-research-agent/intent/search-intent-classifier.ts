// Deterministic, rule-based search-intent classification (informational /
// navigational / commercial / transactional). This is a text-pattern
// judgment about the keyword's own wording, not a numeric claim about the
// real world -- so unlike search volume or difficulty, it carries no
// fabrication risk and needs no external data source. Every classification
// includes the matched signal as its rationale so the result is auditable,
// never an unexplained label.

import type { SearchIntent } from "../types/keyword-request.types.js";

export interface IntentClassification {
  readonly intent: SearchIntent;
  readonly rationale: string;
}

interface IntentSignal {
  readonly pattern: RegExp;
  readonly label: string;
}

const TRANSACTIONAL_SIGNALS: readonly IntentSignal[] = [
  { pattern: /\bbuy\b/i, label: '"buy"' },
  { pattern: /\bprice\b|\bpricing\b/i, label: '"price"/"pricing"' },
  { pattern: /\bdiscount\b|\bcoupon\b|\bdeal\b/i, label: '"discount"/"coupon"/"deal"' },
  { pattern: /\bcheap\b/i, label: '"cheap"' },
  { pattern: /\border\b/i, label: '"order"' },
  { pattern: /\bfor sale\b/i, label: '"for sale"' },
  { pattern: /\bshipping\b/i, label: '"shipping"' },
];

const COMMERCIAL_SIGNALS: readonly IntentSignal[] = [
  { pattern: /\bbest\b/i, label: '"best"' },
  { pattern: /\btop\b/i, label: '"top"' },
  { pattern: /\breviews?\b/i, label: '"review"/"reviews"' },
  { pattern: /\bvs\.?\b|\bversus\b/i, label: '"vs"/"versus"' },
  { pattern: /\bcompar(e|ison)\b/i, label: '"compare"/"comparison"' },
  { pattern: /\balternatives?\b/i, label: '"alternative"/"alternatives"' },
];

const NAVIGATIONAL_SIGNALS: readonly IntentSignal[] = [
  { pattern: /\blog[\s-]?in\b/i, label: '"login"/"log in"' },
  { pattern: /\bsign[\s-]?in\b/i, label: '"sign in"' },
  { pattern: /\bofficial site\b/i, label: '"official site"' },
  { pattern: /\bhomepage\b/i, label: '"homepage"' },
];

function findSignal(keyword: string, signals: readonly IntentSignal[]): IntentSignal | undefined {
  return signals.find(({ pattern }) => pattern.test(keyword));
}

export class SearchIntentClassifier {
  classify(keyword: string): IntentClassification {
    const transactional = findSignal(keyword, TRANSACTIONAL_SIGNALS);
    if (transactional) {
      return {
        intent: "transactional",
        rationale: `Matched transactional signal ${transactional.label}.`,
      };
    }

    const navigational = findSignal(keyword, NAVIGATIONAL_SIGNALS);
    if (navigational) {
      return {
        intent: "navigational",
        rationale: `Matched navigational signal ${navigational.label}.`,
      };
    }

    const commercial = findSignal(keyword, COMMERCIAL_SIGNALS);
    if (commercial) {
      return {
        intent: "commercial",
        rationale: `Matched commercial-investigation signal ${commercial.label}.`,
      };
    }

    return {
      intent: "informational",
      rationale:
        "No transactional, navigational, or commercial-investigation signal matched; " +
        "defaulting to informational per standard search-intent classification convention.",
    };
  }
}
