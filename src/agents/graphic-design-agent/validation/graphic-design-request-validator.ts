// Structural validation and policy-risk detection for an incoming
// GraphicDesignRequest. Structural problems (a blank entry in one of the
// free-text request lists) throw immediately, per GLOBAL_RULES.md SS11 --
// the same "must not contain blank entries" convention
// KeywordRequestValidator applies to seedKeywords. Policy-risk detection
// does NOT throw -- it returns the matched signals so the caller
// (GraphicDesignAgent) can escalate to a human per GLOBAL_RULES.md SS13,
// reflecting this agent's own rule "Use original or properly licensed
// assets."

import { findSignals, type SignalPattern } from "../../../core/find-signals.js";
import type { GraphicDesignRequest } from "../types/graphic-design-request.types.js";

export class GraphicDesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphicDesignValidationError";
  }
}

/**
 * Terms associated with unlicensed or misappropriated creative assets --
 * directly reflecting this agent's own rule "Use original or properly
 * licensed assets."
 */
const POLICY_RISK_PATTERNS: readonly SignalPattern[] = [
  { pattern: /\bsteal\w*\b/i, label: "using stolen assets" },
  { pattern: /copy\w*\s*(from\s*)?competitor/i, label: "copying competitor assets" },
  { pattern: /without\s*(a\s*)?licen[sc]e/i, label: "unlicensed assets" },
  { pattern: /without\s*permission/i, label: "using assets without permission" },
];

export class GraphicDesignRequestValidator {
  /** Throws GraphicDesignValidationError if the request is structurally invalid. */
  validate(request: GraphicDesignRequest): void {
    const freeTextEntries = [
      ...(request.marketingRequirements ?? []),
      ...(request.websiteRequirements ?? []),
      ...(request.designRequests ?? []),
    ];
    for (const entry of freeTextEntries) {
      if (!entry.trim()) {
        throw new GraphicDesignValidationError(
          "marketingRequirements, websiteRequirements, and designRequests must not contain blank entries.",
        );
      }
    }
  }

  /** Returns the labels of every policy-risk signal found in the request; empty if none. */
  findPolicyRiskSignals(request: GraphicDesignRequest): string[] {
    const haystack = [
      request.brandGuidelines ?? "",
      ...(request.marketingRequirements ?? []),
      ...(request.websiteRequirements ?? []),
      ...(request.designRequests ?? []),
    ].join(" ");

    return findSignals(haystack, POLICY_RISK_PATTERNS);
  }
}
