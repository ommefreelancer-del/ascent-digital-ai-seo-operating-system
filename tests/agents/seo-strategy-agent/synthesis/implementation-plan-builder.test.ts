import { describe, expect, it } from "vitest";
import { ImplementationPlanBuilder } from "../../../../src/agents/seo-strategy-agent/synthesis/implementation-plan-builder.js";
import type { SeoRoadmap, StrategyItem } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";

function makeItem(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    id: "item-1",
    source: "technical-seo",
    category: "crawlability",
    description: "Fix the robots.txt disallow rule.",
    rationale: "It is blocking indexing.",
    impact: "high",
    effort: "low",
    confirmedBySources: [],
    priorityScore: 3,
    ...overrides,
  };
}

describe("ImplementationPlanBuilder", () => {
  const builder = new ImplementationPlanBuilder();

  it("flattens phases in order into a single numbered plan", () => {
    const phaseOneItem = makeItem({ id: "phase-1-item", description: "Do phase 1 thing." });
    const phaseTwoItem = makeItem({ id: "phase-2-item", description: "Do phase 2 thing." });
    const roadmap: SeoRoadmap = {
      phases: [
        { label: "0-30 days", items: [phaseOneItem] },
        { label: "31-60 days", items: [phaseTwoItem] },
        { label: "61-90 days", items: [] },
      ],
      deprioritized: [],
    };

    const plan = builder.build(roadmap);

    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({
      sequence: 1,
      source: phaseOneItem.source,
      category: phaseOneItem.category,
      action: phaseOneItem.description,
      rationale: phaseOneItem.rationale,
    });
    expect(plan[1]?.sequence).toBe(2);
    expect(plan[1]?.action).toBe("Do phase 2 thing.");
  });

  it("excludes deprioritized items from the implementation plan", () => {
    const roadmap: SeoRoadmap = {
      phases: [
        { label: "0-30 days", items: [] },
        { label: "31-60 days", items: [] },
        { label: "61-90 days", items: [] },
      ],
      deprioritized: [makeItem({ id: "deprioritized-item" })],
    };

    expect(builder.build(roadmap)).toHaveLength(0);
  });

  it("returns an empty plan for an entirely empty roadmap", () => {
    const roadmap: SeoRoadmap = {
      phases: [
        { label: "0-30 days", items: [] },
        { label: "31-60 days", items: [] },
        { label: "61-90 days", items: [] },
      ],
      deprioritized: [],
    };

    expect(builder.build(roadmap)).toEqual([]);
  });
});
