// Structural validation and destructive-action detection for an incoming
// WebsiteManagementRequest. Structural problems (empty url, a genuine
// cross-input mismatch) throw immediately, per GLOBAL_RULES.md SS11 "report
// inconsistencies instead of silently correcting them". Destructive-action
// detection does NOT throw -- it returns the matched signals so the caller
// (WebsiteManagementAgent) can escalate to a human per GLOBAL_RULES.md SS9
// ("never make destructive changes without approval") before surfacing a
// caller-supplied update request or security alert as a maintenance
// recommendation, since a restore/rollback/deletion is irreversible.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { WebsiteManagementRequest } from "../types/website-management-request.types.js";

export class WebsiteManagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteManagementValidationError";
  }
}

/**
 * Terms associated with irreversible or externally-destructive operations,
 * directly reflecting this agent's own rules ("Always create backups before
 * major changes", "Never make destructive changes without approval").
 */
const DESTRUCTIVE_ACTION_PATTERNS: readonly SignalPattern[] = [
  { pattern: /restore\b/i, label: "backup restore" },
  { pattern: /roll\s*back/i, label: "rollback" },
  { pattern: /delet(e|ion)/i, label: "deletion" },
  { pattern: /\bremove\b/i, label: "removal" },
  { pattern: /uninstall/i, label: "uninstall" },
  { pattern: /downgrade/i, label: "downgrade" },
  { pattern: /wipe|reset\s*(the\s*)?(site|database)/i, label: "site/database reset" },
  { pattern: /disable\s*(security|firewall|ssl)/i, label: "disabling a security control" },
];

export class WebsiteManagementRequestValidator {
  /** Throws WebsiteManagementValidationError if the request is structurally invalid or internally inconsistent. */
  validate(request: WebsiteManagementRequest): void {
    if (!request.url.trim()) {
      throw new WebsiteManagementValidationError("url must not be empty.");
    }
    if (request.websiteAudit.url !== null && request.websiteAudit.url !== request.url) {
      throw new WebsiteManagementValidationError(
        `websiteAudit appears to describe a different page ("${request.websiteAudit.url}") than the ` +
          `requested url ("${request.url}").`,
      );
    }
    if (request.technicalSeo.url !== null && request.technicalSeo.url !== request.url) {
      throw new WebsiteManagementValidationError(
        `technicalSeo appears to describe a different page ("${request.technicalSeo.url}") than the ` +
          `requested url ("${request.url}").`,
      );
    }
  }

  /** Returns the labels of every destructive-action signal found in updateRequests/securityAlerts; empty if none. */
  findDestructiveActionSignals(request: WebsiteManagementRequest): string[] {
    const haystack = [...(request.updateRequests ?? []), ...(request.securityAlerts ?? [])].join(" ");
    return findSignals(haystack, DESTRUCTIVE_ACTION_PATTERNS);
  }
}
