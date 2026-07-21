import { describe, expect, it } from "vitest";
import type { AgentDirectory } from "../../../src/boss-agent/registry/agent-registry.js";
import { TaskRouter, type TaskRouterConfig } from "../../../src/boss-agent/routing/task-router.js";
import type { RoutingStrategy } from "../../../src/boss-agent/routing/routing-strategy.js";
import type { AgentSpec } from "../../../src/boss-agent/types/agent-spec.types.js";
import type { RoutingCandidate } from "../../../src/boss-agent/types/routing.types.js";
import type { TaskInput } from "../../../src/boss-agent/types/task.types.js";

function makeSpec(id: string, title: string): AgentSpec {
  return {
    id,
    sourcePath: `/Agents/${id}.md`,
    title,
    mission: "",
    responsibilities: ["placeholder"],
    inputs: [],
    outputs: [],
    communicatesWith: { receives: [], sends: [] },
    tools: [],
    rules: [],
    successCriteria: [],
  };
}

function makeDirectory(specs: AgentSpec[]): AgentDirectory {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return {
    list: () => specs,
    getById: (id) => byId.get(id),
    has: (id) => byId.has(id),
    size: () => specs.length,
  };
}

/** A strategy whose scores are fixed per agent id, for deterministic tests. */
function makeFixedScoreStrategy(scoresByAgentId: Record<string, number>): RoutingStrategy {
  return {
    name: "fixed-score",
    score(_task: TaskInput, candidate: AgentSpec): RoutingCandidate {
      const score = scoresByAgentId[candidate.id] ?? 0;
      return {
        agentId: candidate.id,
        agentTitle: candidate.title,
        score,
        matchedTerms: score > 0 ? ["fixture-term"] : [],
      };
    },
  };
}

const CONFIG: TaskRouterConfig = { autoAssignThreshold: 0.5, tieMargin: 0.15, maxCandidates: 5 };
const TASK: TaskInput = { id: "task-1", description: "anything", priority: "normal" };

describe("TaskRouter", () => {
  it("auto-assigns the top candidate when it clears both the threshold and the tie margin", () => {
    const registry = makeDirectory([makeSpec("a", "Agent A"), makeSpec("b", "Agent B")]);
    const router = new TaskRouter(registry, makeFixedScoreStrategy({ a: 0.9, b: 0.2 }), CONFIG);

    const decision = router.route(TASK);

    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("a");
    expect(decision.escalationReason).toBeUndefined();
  });

  it("escalates as low-confidence when the top score is below the auto-assign threshold", () => {
    const registry = makeDirectory([makeSpec("a", "Agent A"), makeSpec("b", "Agent B")]);
    const router = new TaskRouter(registry, makeFixedScoreStrategy({ a: 0.4, b: 0.1 }), CONFIG);

    const decision = router.route(TASK);

    expect(decision.status).toBe("escalated");
    expect(decision.escalationReason).toBe("low_confidence_match");
    expect(decision.assignedAgentId).toBeUndefined();
  });

  it("escalates as ambiguous when two candidates are too close despite both being above threshold", () => {
    const registry = makeDirectory([makeSpec("a", "Agent A"), makeSpec("b", "Agent B")]);
    const router = new TaskRouter(registry, makeFixedScoreStrategy({ a: 0.6, b: 0.55 }), CONFIG);

    const decision = router.route(TASK);

    expect(decision.status).toBe("escalated");
    expect(decision.escalationReason).toBe("ambiguous_match");
  });

  it("escalates as no-matching-candidate when every score is zero", () => {
    const registry = makeDirectory([makeSpec("a", "Agent A"), makeSpec("b", "Agent B")]);
    const router = new TaskRouter(registry, makeFixedScoreStrategy({}), CONFIG);

    const decision = router.route(TASK);

    expect(decision.status).toBe("escalated");
    expect(decision.escalationReason).toBe("no_matching_candidate");
  });

  it("truncates the candidate list on the decision to maxCandidates", () => {
    const registry = makeDirectory([
      makeSpec("a", "Agent A"),
      makeSpec("b", "Agent B"),
      makeSpec("c", "Agent C"),
    ]);
    const router = new TaskRouter(
      registry,
      makeFixedScoreStrategy({ a: 0.9, b: 0.8, c: 0.7 }),
      { ...CONFIG, maxCandidates: 2 },
    );

    const decision = router.route(TASK);

    expect(decision.candidates).toHaveLength(2);
  });

  it("ranks candidates by score, highest first, regardless of registry order", () => {
    const registry = makeDirectory([makeSpec("low", "Low"), makeSpec("high", "High")]);
    const router = new TaskRouter(registry, makeFixedScoreStrategy({ low: 0.1, high: 0.9 }), CONFIG);

    const decision = router.route(TASK);

    expect(decision.candidates[0]?.agentId).toBe("high");
    expect(decision.assignedAgentId).toBe("high");
  });
});
