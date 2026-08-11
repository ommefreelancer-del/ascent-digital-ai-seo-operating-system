import { describe, expect, it } from "vitest";
import { ComplianceValidator, ComplianceViolationError } from "../../../src/boss-agent/governance/compliance-validator.js";
import type { AgentDirectory } from "../../../src/boss-agent/registry/agent-registry.js";
import type { AgentSpec } from "../../../src/boss-agent/types/agent-spec.types.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeSpec(id: string): AgentSpec {
  return {
    id,
    sourcePath: `/Agents/${id}.md`,
    title: id,
    mission: "",
    responsibilities: ["placeholder"],
    inputs: [],
    outputs: [],
    communicatesWith: { receives: [], sends: [] },
    tools: [],
    rules: [],
    successCriteria: [],
    tags: [],
    capabilities: [],
  };
}

function makeDirectory(ids: string[]): AgentDirectory {
  const specs = ids.map(makeSpec);
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return {
    list: () => specs,
    getById: (id) => byId.get(id),
    has: (id) => byId.has(id),
    size: () => specs.length,
  };
}

const NOW = new Date().toISOString();

describe("ComplianceValidator", () => {
  const validator = new ComplianceValidator();
  const registry = makeDirectory(["agent-a", "agent-b"]);

  it("passes a well-formed assigned decision", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      assignedAgentId: "agent-a",
      candidates: [{ agentId: "agent-a", agentTitle: "agent-a", score: 0.9, matchedTerms: ["x"] }],
      rationale: "Clear match.",
      decidedAt: NOW,
    };

    expect(validator.validate(decision, registry)).toEqual({ valid: true, violations: [] });
  });

  it("flags an assigned decision that references an agent outside the registry", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      assignedAgentId: "agent-does-not-exist",
      candidates: [],
      rationale: "Clear match.",
      decidedAt: NOW,
    };

    const result = validator.validate(decision, registry);

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("does not exist in the loaded registry"))).toBe(true);
  });

  it("flags an assigned decision with no assignedAgentId", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      candidates: [],
      rationale: "Clear match.",
      decidedAt: NOW,
    };

    const result = validator.validate(decision, registry);
    expect(result.valid).toBe(false);
  });

  it("flags an assigned decision with an empty rationale", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      assignedAgentId: "agent-a",
      candidates: [],
      rationale: "   ",
      decidedAt: NOW,
    };

    const result = validator.validate(decision, registry);
    expect(result.valid).toBe(false);
  });

  it("flags an escalated decision that also carries an assignedAgentId", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "escalated",
      assignedAgentId: "agent-a",
      candidates: [],
      rationale: "Ambiguous.",
      decidedAt: NOW,
      escalationReason: "ambiguous_match",
    };

    const result = validator.validate(decision, registry);
    expect(result.valid).toBe(false);
  });

  it("flags an escalated decision missing an escalationReason", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "escalated",
      candidates: [],
      rationale: "Ambiguous.",
      decidedAt: NOW,
    };

    const result = validator.validate(decision, registry);
    expect(result.valid).toBe(false);
  });

  it("passes a well-formed rejected decision", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "rejected",
      candidates: [],
      rationale: "Human declined to assign.",
      decidedAt: NOW,
    };

    expect(validator.validate(decision, registry).valid).toBe(true);
  });

  it("assertValid throws ComplianceViolationError with the violation list attached", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      assignedAgentId: "unknown-agent",
      candidates: [],
      rationale: "x",
      decidedAt: NOW,
    };

    expect(() => validator.assertValid(decision, registry)).toThrow(ComplianceViolationError);

    let caught: unknown;
    try {
      validator.assertValid(decision, registry);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ComplianceViolationError);
    expect((caught as ComplianceViolationError).violations.length).toBeGreaterThan(0);
  });
});
