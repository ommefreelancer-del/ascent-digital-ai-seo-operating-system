// Determines whether a message carries enough real content to route -- per
// the architecture doc's "Intent Detection" responsibility ("Whether
// additional clarification is required"). A deterministic word-count
// threshold, not a fabricated understanding of what the user "really
// means" -- consistent with this module's own rule to "avoid making
// assumptions" and "never fabricate information".

import type { ConversationIntent } from "../types/conversation.types.js";

const MIN_WORDS_FOR_TASK_REQUEST = 3;

// A real URL is unambiguous, structured input on its own -- e.g. "Audit
// https://example.com" is only 2 whitespace-separated tokens (the URL itself
// contains no spaces), but it names an exact, actionable target. Requiring
// this doesn't fabricate intent; it recognizes content the word-count
// heuristic alone can't see.
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;

export class IntentClassifier {
  classify(message: string): ConversationIntent {
    if (URL_PATTERN.test(message)) {
      return "task_request";
    }

    const wordCount = message
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    return wordCount < MIN_WORDS_FOR_TASK_REQUEST ? "clarification_needed" : "task_request";
  }
}
