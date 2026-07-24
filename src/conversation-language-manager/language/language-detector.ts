// Detects which supported language a message is written in -- per the
// architecture doc's "Automatically detect the user's communication
// language" responsibility. Detection is a deterministic character-range
// check (the Arabic/Urdu Unicode script blocks U+0600-U+06FF and
// U+0750-U+077F), never a fabricated ML claim: if at least
// URDU_SCRIPT_RATIO_THRESHOLD of the message's non-whitespace characters
// fall in that script range, the message is detected as Urdu; otherwise it
// defaults to English, the platform's primary operating language per the
// architecture doc.

import type { SupportedLanguage } from "../types/conversation.types.js";

const URDU_SCRIPT_PATTERN = /[؀-ۿݐ-ݿ]/g;
const URDU_SCRIPT_RATIO_THRESHOLD = 0.3;

export class LanguageDetector {
  detect(message: string, languageOverride?: SupportedLanguage): SupportedLanguage {
    if (languageOverride) {
      return languageOverride;
    }

    const nonWhitespace = message.replace(/\s+/g, "");
    if (nonWhitespace.length === 0) {
      return "en";
    }

    const urduMatches = nonWhitespace.match(URDU_SCRIPT_PATTERN) ?? [];
    const ratio = urduMatches.length / nonWhitespace.length;
    return ratio >= URDU_SCRIPT_RATIO_THRESHOLD ? "ur" : "en";
  }
}
