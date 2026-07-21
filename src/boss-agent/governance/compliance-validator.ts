// Deterministic, rule-based safety net that runs on every RoutingDecision
// before it is treated as final. It re-checks invariants the router and
// escalation handler are each expected to uphold on their own, catching
// regressions rather than trusting either module blindly — a defense-in-depth
// reading of GLOBAL_RULES.md SS1 (Accuracy First) and SS2 (Anti-Hallucination):
// an "assigned" decision must reference a real agent and carry a real reason.

import type { AgentDirectory } from "../registry/agent-registry.js";
import type { RoutingDecision } from "../types/routing.types.js";

export interface ComplianceResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export class ComplianceViolationError extends Error {
  constructor(public readonly violations: readonly string[]) {
    super(`Routing decision failed compliance validation: ${violations.join(" | ")}`);
    this.name = "ComplianceViolationError";
  }
}

export class ComplianceValidator {
  validate(decision: RoutingDecision, registry: AgentDirectory): ComplianceResult {
    const violations: string[] = [];

    if (decision.status === "assigned") {
      if (!decision.assignedAgentId) {
        violations.push("Status is 'assigned' but no assignedAgentId was set.");
      } else if (!registry.has(decision.assignedAgentId)) {
        violations.push(
          `Status is 'assigned' but agent id "${decision.assignedAgentId}" does not exist in the loaded registry.`,
        );
      }
      if (!decision.rationale.trim()) {
        violations.push("Status is 'assigned' but the rationale is empty.");
      }
    } else if (decision.assignedAgentId) {
      violations.push(`Status is '${decision.status}' but an assignedAgentId is also set.`);
    }

    if (decision.status === "escalated" && !decision.escalationReason) {
      violations.push("Status is 'escalated' but no escalationReason was set.");
    }

    return { valid: violations.length === 0, violations };
  }

  /** Throws ComplianceViolationError if `decision` fails validate(). */
  assertValid(decision: RoutingDecision, registry: AgentDirectory): void {
    const result = this.validate(decision, registry);
    if (!result.valid) {
      throw new ComplianceViolationError(result.violations);
    }
  }
}
