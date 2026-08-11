import { describe, expect, it } from "vitest";
import { KeywordMatchRoutingStrategy } from "../../../src/boss-agent/routing/keyword-match-routing-strategy.js";
import type { AgentSpec } from "../../../src/boss-agent/types/agent-spec.types.js";
import type { TaskInput } from "../../../src/boss-agent/types/task.types.js";

function makeAgentSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    id: "keyword-research-agent",
    sourcePath: "/Agents/keyword-research-agent.md",
    title: "Keyword Research Agent",
    mission: "Identify high-value keywords and analyze search intent.",
    responsibilities: ["Perform comprehensive keyword research.", "Group keywords into topic clusters."],
    inputs: ["Business objectives"],
    outputs: ["Keyword Research Report"],
    communicatesWith: { receives: [], sends: [] },
    tools: [],
    rules: [],
    successCriteria: [],
    tags: [],
    capabilities: [],
    ...overrides,
  };
}

function makeTask(description: string): TaskInput {
  return { id: "task-1", description, priority: "normal" };
}

describe("KeywordMatchRoutingStrategy", () => {
  const strategy = new KeywordMatchRoutingStrategy();

  it("scores 1.0 when every meaningful task term appears in the agent's spec", () => {
    const result = strategy.score(makeTask("Perform keyword research"), makeAgentSpec());

    // Meaningful terms: perform, keyword, research - all three appear in the
    // agent's responsibilities ("Perform comprehensive keyword research.").
    expect(result.score).toBe(1);
    expect(result.matchedTerms).toEqual(["keyword", "perform", "research"]);
  });

  it("scores partially when only some terms match", () => {
    const result = strategy.score(
      makeTask("Perform keyword research and fix invoice billing"),
      makeAgentSpec(),
    );

    // Meaningful terms after stopword/short-token filtering: perform, keyword,
    // research, fix, invoice, billing (6 terms); only "perform", "keyword",
    // and "research" appear anywhere in the agent spec's mission/
    // responsibilities/inputs/outputs.
    expect(result.matchedTerms).toEqual(["keyword", "perform", "research"]);
    expect(result.score).toBeCloseTo(3 / 6, 5);
  });

  it("scores 0 when no meaningful terms overlap", () => {
    const result = strategy.score(makeTask("Negotiate publisher backlink pricing"), makeAgentSpec());

    expect(result.score).toBe(0);
    expect(result.matchedTerms).toEqual([]);
  });

  it("scores 0 and reports no matched terms when the task description has no meaningful tokens", () => {
    const result = strategy.score(makeTask("do it"), makeAgentSpec());

    expect(result.score).toBe(0);
    expect(result.matchedTerms).toEqual([]);
  });

  it("ignores casing and punctuation", () => {
    const result = strategy.score(makeTask("KEYWORD-RESEARCH!!"), makeAgentSpec());

    expect(result.matchedTerms).toEqual(["keyword", "research"]);
  });

  it("carries the candidate's id and title through unchanged", () => {
    const result = strategy.score(makeTask("keyword research"), makeAgentSpec({ id: "x", title: "X Agent" }));

    expect(result.agentId).toBe("x");
    expect(result.agentTitle).toBe("X Agent");
  });

  it("produces the same real score for the same real candidate object across repeated calls (memoized term set)", () => {
    const candidate = makeAgentSpec();

    const first = strategy.score(makeTask("Perform keyword research"), candidate);
    const second = strategy.score(makeTask("Perform keyword research"), candidate);

    expect(second).toEqual(first);
  });

  it("scores independently for two different task descriptions against the same cached candidate", () => {
    const candidate = makeAgentSpec();

    const broadMatch = strategy.score(makeTask("Perform keyword research"), candidate);
    const noMatch = strategy.score(makeTask("Negotiate publisher backlink pricing"), candidate);

    expect(broadMatch.score).toBe(1);
    expect(noMatch.score).toBe(0);
  });

  it("keeps two distinct AgentSpec objects with identical content scored independently (cache keyed by identity, not content)", () => {
    const specA = makeAgentSpec({ id: "a", title: "A" });
    const specB = makeAgentSpec({ id: "b", title: "B" });

    const resultA = strategy.score(makeTask("Perform keyword research"), specA);
    const resultB = strategy.score(makeTask("Perform keyword research"), specB);

    expect(resultA.agentId).toBe("a");
    expect(resultB.agentId).toBe("b");
    expect(resultA.matchedTerms).toEqual(resultB.matchedTerms);
  });
});
