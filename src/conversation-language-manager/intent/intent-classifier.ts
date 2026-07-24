// Determines whether a message carries enough real content to route -- per
// the architecture doc's "Intent Detection" responsibility ("Whether
// additional clarification is required"). A deterministic word-count
// threshold, not a fabricated understanding of what the user "really
// means" -- consistent with this module's own rule to "avoid making
// assumptions" and "never fabricate information".

import type { ConversationIntent } from "../types/conversation.types.js";

const MIN_WORDS_FOR_TASK_REQUEST = 3;

export class IntentClassifier {
  classify(message: string): ConversationIntent {
    const wordCount = message
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    return wordCount < MIN_WORDS_FOR_TASK_REQUEST ? "clarification_needed" : "task_request";
  }
}
