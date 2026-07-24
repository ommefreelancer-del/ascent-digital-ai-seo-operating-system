// Structural validation and destructive-action detection for an incoming
// WebDevelopmentRequest. Structural problems (a genuine cross-input
// mismatch) throw immediately, per GLOBAL_RULES.md SS11 "report
// inconsistencies instead of silently correcting them". Destructive-action
// detection does NOT throw -- it returns the matched signals so the caller
// (WebDevelopmentAgent) can escalate to a human per GLOBAL_RULES.md SS9
// before turning a caller-supplied bug report, requirement, or design asset
// into a development task, since deleting data, disabling security
// controls, or hardcoding credentials are irreversible or unsafe.

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { WebDevelopmentRequest } from "../types/web-development-request.types.js";

export class WebDevelopmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebDevelopmentValidationError";
  }
}

/**
 * Terms associated with irreversible or unsafe code changes, directly
 * reflecting this agent's own rules ("Write secure and maintainable code",
 * "Test changes before deployment").
 */
const DESTRUCTIVE_ACTION_PATTERNS: readonly SignalPattern[] = [
  { pattern: /drop\s*table/i, label: "database table drop" },
  { pattern: /delet(e|ion)/i, label: "deletion" },
  { pattern: /\bremove\b/i, label: "removal" },
  { pattern: /disable\s*(auth(entication)?|security|ssl|https)/i, label: "disabling a security control" },
  { pattern: /bypass\s*(auth(entication)?|security)/i, label: "bypassing security" },
  { pattern: /hardcod(e|ed)\b[\s\S]{0,30}(password|credential|secret|api\s*key)/i, label: "hardcoded credentials" },
  { pattern: /roll\s*back/i, label: "rollback" },
  { pattern: /force\s*push/i, label: "force push" },
];

export class WebDevelopmentRequestValidator {
  /** Throws WebDevelopmentValidationError if the request is internally inconsistent. */
  validate(request: WebDevelopmentRequest): void {
    if (
      request.websiteAudit.url !== null &&
      request.technicalSeo.url !== null &&
      request.websiteAudit.url !== request.technicalSeo.url
    ) {
      throw new WebDevelopmentValidationError(
        `websiteAudit ("${request.websiteAudit.url}") and technicalSeo ("${request.technicalSeo.url}") ` +
          "appear to describe different pages.",
      );
    }
  }

  /** Returns the labels of every destructive-action signal found in the request's free-text fields; empty if none. */
  findDestructiveActionSignals(request: WebDevelopmentRequest): string[] {
    const haystack = [
      request.businessRequirements ?? "",
      ...(request.bugReports ?? []),
      ...(request.designAssets ?? []),
    ].join(" ");

    return findSignals(haystack, DESTRUCTIVE_ACTION_PATTERNS);
  }
}
