// Structural validation and destructive-action detection for an incoming
// AdminRequest. Structural problems (blank names/descriptions) throw
// immediately, per GLOBAL_RULES.md SS11. Destructive-action detection does
// NOT throw -- it returns the matched signals so the caller (AdminAgent) can
// escalate to a human per GLOBAL_RULES.md SS9, reflecting this agent's own
// rule "never delete critical records without approval." Note "archive" is
// deliberately NOT a flagged signal: archiving completed projects is one of
// this agent's own normal responsibilities, not a destructive action.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { AdminRequest } from "../types/admin-request.types.js";

export class AdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminValidationError";
  }
}

/**
 * Terms associated with irreversible record loss, directly reflecting this
 * agent's own rule "never delete critical records without approval."
 */
const DESTRUCTIVE_ACTION_PATTERNS: readonly SignalPattern[] = [
  { pattern: /delet(e|ion)/i, label: "deletion" },
  { pattern: /\bremove\b/i, label: "removal" },
  { pattern: /purge/i, label: "purge" },
  { pattern: /\bwipe\b/i, label: "wipe" },
];

export class AdminRequestValidator {
  /** Throws AdminValidationError if the request is structurally invalid. */
  validate(request: AdminRequest): void {
    for (const doc of request.internalDocuments ?? []) {
      if (!doc.name.trim()) {
        throw new AdminValidationError("Every internalDocuments entry must have a non-empty name.");
      }
    }
    for (const update of request.projectUpdates ?? []) {
      if (!update.projectName.trim()) {
        throw new AdminValidationError("Every projectUpdates entry must have a non-empty projectName.");
      }
    }
    for (const request_ of request.teamRequests ?? []) {
      if (!request_.description.trim()) {
        throw new AdminValidationError("Every teamRequests entry must have a non-empty description.");
      }
    }
  }

  /** Returns the labels of every destructive-action signal found in teamRequests/projectUpdates text; empty if none. */
  findDestructiveActionSignals(request: AdminRequest): string[] {
    const haystack = [
      ...(request.teamRequests ?? []).map((r) => r.description),
      ...(request.projectUpdates ?? []).map((u) => u.note),
    ].join(" ");

    return findSignals(haystack, DESTRUCTIVE_ACTION_PATTERNS);
  }
}
