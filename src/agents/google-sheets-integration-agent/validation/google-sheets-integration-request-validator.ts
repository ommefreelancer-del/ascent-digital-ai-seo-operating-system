// Structural validation and destructive-action detection for an incoming
// GoogleSheetsIntegrationRequest. Structural problems (a blank
// spreadsheetId) throw immediately, per GLOBAL_RULES.md SS11.
// Destructive-action detection does NOT throw -- it returns the matched
// signals so the caller (GoogleSheetsIntegrationAgent) can escalate to a
// human per GLOBAL_RULES.md SS9, reflecting this agent's own rules "never
// overwrite existing data without validation" and "request user approval
// before major updates or deletions."

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { GoogleSheetsIntegrationRequest } from "../types/google-sheets-integration-request.types.js";

export class GoogleSheetsIntegrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetsIntegrationValidationError";
  }
}

/**
 * Terms associated with irreversible or unvalidated data loss, directly
 * reflecting this agent's own rules ("never overwrite existing data without
 * validation", "request user approval before major updates or deletions").
 */
const DESTRUCTIVE_ACTION_PATTERNS: readonly SignalPattern[] = [
  { pattern: /overwrite/i, label: "overwrite" },
  { pattern: /delet(e|ion)/i, label: "deletion" },
  { pattern: /\bremove\b/i, label: "removal" },
  { pattern: /purge/i, label: "purge" },
  { pattern: /\bwipe\b/i, label: "wipe" },
];

export class GoogleSheetsIntegrationRequestValidator {
  /** Throws GoogleSheetsIntegrationValidationError if the request is structurally invalid. */
  validate(request: GoogleSheetsIntegrationRequest): void {
    if (!request.spreadsheetId.trim()) {
      throw new GoogleSheetsIntegrationValidationError("spreadsheetId must not be empty.");
    }
  }

  /** Returns the labels of every destructive-action signal found in userInstructions; empty if none. */
  findDestructiveActionSignals(request: GoogleSheetsIntegrationRequest): string[] {
    const haystack = request.userInstructions ?? "";
    return findSignals(haystack, DESTRUCTIVE_ACTION_PATTERNS);
  }
}
