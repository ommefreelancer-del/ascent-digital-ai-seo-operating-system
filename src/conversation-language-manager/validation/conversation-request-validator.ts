// Structural validation and prompt-injection detection for an incoming
// ConversationRequest, per the architecture doc's "Request Validation" and
// "Security Responsibilities" sections. Structural problems (a blank
// message) throw immediately, per GLOBAL_RULES.md SS11. Prompt-injection
// detection does NOT throw -- it returns the matched signals so the caller
// (ConversationLanguageManager) can escalate to a human via the
// "prompt_injection" reason, reflecting this module's own responsibility to
// "enforce governance policies before any request reaches the Boss Agent"
// and to never bypass the platform's security architecture.

import { findSignals, type SignalPattern } from "../../core/find-signals.js";
import type { ConversationRequest } from "../types/conversation.types.js";

export class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

/**
 * Patterns associated with attempts to override this platform's own
 * instructions or disclose its configuration, directly reflecting this
 * module's own responsibilities "Prompt injection detection" and "Unsafe
 * instruction detection."
 */
const PROMPT_INJECTION_PATTERNS: readonly SignalPattern[] = [
  { pattern: /ignore\s+(all\s+|the\s+)?(previous|prior|above)\s+instructions/i, label: "instruction override attempt" },
  { pattern: /forget\s+(all\s+|your\s+)?(previous\s+)?instructions/i, label: "instruction override attempt" },
  { pattern: /disregard\s+(the\s+)?system\s+prompt/i, label: "system prompt override attempt" },
  { pattern: /reveal\s+(your|the)\s+(system\s+prompt|instructions)/i, label: "system prompt disclosure attempt" },
  { pattern: /you\s+are\s+now\s+/i, label: "role override attempt" },
];

export class ConversationRequestValidator {
  /** Throws ConversationValidationError if the request is structurally invalid. */
  validate(request: ConversationRequest): void {
    if (!request.message.trim()) {
      throw new ConversationValidationError("message must not be empty.");
    }
  }

  /** Returns the labels of every prompt-injection signal found in the message; empty if none. */
  findPromptInjectionSignals(request: ConversationRequest): string[] {
    return findSignals(request.message, PROMPT_INJECTION_PATTERNS);
  }
}
