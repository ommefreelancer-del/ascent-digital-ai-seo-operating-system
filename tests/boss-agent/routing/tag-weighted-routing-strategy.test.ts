import { describe, expect, it } from "vitest";
import { TagWeightedRoutingStrategy } from "../../../src/boss-agent/routing/tag-weighted-routing-strategy.js";
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

describe("TagWeightedRoutingStrategy", () => {
  const strategy = new TagWeightedRoutingStrategy();
  const keywordOnly = new KeywordMatchRoutingStrategy();

  it("REGRESSION: matches KeywordMatchRoutingStrategy exactly for an agent with no tags/capabilities", () => {
    const candidate = makeAgentSpec();
    const task = makeTask("Perform keyword research and fix invoice billing");

    const tagWeighted = strategy.score(task, candidate);
    const keywordScore = keywordOnly.score(task, candidate);

    expect(tagWeighted.score).toBe(keywordScore.score);
    expect(tagWeighted.matchedTerms).toEqual(keywordScore.matchedTerms);
  });

  it("REGRESSION: an untagged agent still scores 0 for a completely unrelated task", () => {
    const result = strategy.score(makeTask("Negotiate publisher backlink pricing"), makeAgentSpec());
    expect(result.score).toBe(0);
  });

  it("boosts the score when tag/capability terms match, even if keyword overlap alone would be lower", () => {
    const candidate = makeAgentSpec({
      mission: "Coordinate specialist agents.",
      responsibilities: ["Route tasks."],
      inputs: [],
      outputs: [],
      tags: ["seo-audit", "core-web-vitals"],
      capabilities: ["Analyze Core Web Vitals and page performance"],
    });
    const task = makeTask("Run a full seo audit and check core web vitals");

    const withTags = strategy.score(task, candidate);
    const keywordOnlyResult = keywordOnly.score(task, candidate);

    expect(withTags.score).toBeGreaterThan(keywordOnlyResult.score);
  });

  it("never exceeds a score of 1", () => {
    const candidate = makeAgentSpec({
      mission: "Perform keyword research.",
      responsibilities: ["Perform keyword research."],
      tags: ["keyword", "research"],
      capabilities: [],
    });
    const result = strategy.score(makeTask("keyword research"), candidate);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("scores 0 for an empty/meaningless task description regardless of tags", () => {
    const candidate = makeAgentSpec({ tags: ["seo-audit"], capabilities: ["Audit websites"] });
    const result = strategy.score(makeTask("do it"), candidate);
    expect(result.score).toBe(0);
    expect(result.matchedTerms).toEqual([]);
  });

  it("merges matched keyword and tag terms into one sorted, de-duplicated list", () => {
    const candidate = makeAgentSpec({
      mission: "Perform keyword research.",
      responsibilities: [],
      inputs: [],
      outputs: [],
      tags: ["audit"],
      capabilities: [],
    });
    const result = strategy.score(makeTask("Perform an audit"), candidate);
    expect(result.matchedTerms).toEqual(["audit", "perform"]);
  });

  it("carries the candidate's id and title through unchanged", () => {
    const result = strategy.score(
      makeTask("keyword research"),
      makeAgentSpec({ id: "x", title: "X Agent", tags: ["keyword"] }),
    );
    expect(result.agentId).toBe("x");
    expect(result.agentTitle).toBe("X Agent");
  });

  it("memoizes keyword and tag term sets per candidate object (identity, not content)", () => {
    const candidate = makeAgentSpec({ tags: ["seo-audit"] });
    const first = strategy.score(makeTask("seo audit"), candidate);
    const second = strategy.score(makeTask("seo audit"), candidate);
    expect(second).toEqual(first);
  });
});
