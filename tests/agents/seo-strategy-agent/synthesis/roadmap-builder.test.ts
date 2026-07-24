import { describe, expect, it } from "vitest";
import { RoadmapBuilder } from "../../../../src/agents/seo-strategy-agent/synthesis/roadmap-builder.js";
import type { PrioritizationMatrix, StrategyItem } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";

function makeItem(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    id: "item-1",
    source: "technical-seo",
    category: "crawlability",
    description: "Fix it.",
    rationale: "Because.",
    impact: "high",
    effort: "low",
    confirmedBySources: [],
    priorityScore: 1,
    ...overrides,
  };
}

function makeMatrix(overrides: Partial<PrioritizationMatrix> = {}): PrioritizationMatrix {
  return { quickWins: [], majorProjects: [], fillIns: [], thankless: [], ...overrides };
}

describe("RoadmapBuilder", () => {
  const builder = new RoadmapBuilder();

  it("schedules quick wins into 0-30 days, major projects into 31-60, fill-ins into 61-90", () => {
    const quickWin = makeItem({ id: "quick-win" });
    const majorProject = makeItem({ id: "major-project" });
    const fillIn = makeItem({ id: "fill-in" });

    const roadmap = builder.build(makeMatrix({ quickWins: [quickWin], majorProjects: [majorProject], fillIns: [fillIn] }));

    expect(roadmap.phases).toHaveLength(3);
    expect(roadmap.phases[0]).toEqual({ label: "0-30 days", items: [quickWin] });
    expect(roadmap.phases[1]).toEqual({ label: "31-60 days", items: [majorProject] });
    expect(roadmap.phases[2]).toEqual({ label: "61-90 days", items: [fillIn] });
  });

  it("excludes thankless items from the active phases and lists them as deprioritized instead", () => {
    const thanklessItem = makeItem({ id: "thankless-item" });
    const roadmap = builder.build(makeMatrix({ thankless: [thanklessItem] }));

    expect(roadmap.phases.every((phase) => phase.items.length === 0)).toBe(true);
    expect(roadmap.deprioritized).toEqual([thanklessItem]);
  });

  it("sorts items within each phase by priorityScore, highest first", () => {
    const low = makeItem({ id: "low", priorityScore: 1 });
    const high = makeItem({ id: "high", priorityScore: 5 });
    const medium = makeItem({ id: "medium", priorityScore: 3 });

    const roadmap = builder.build(makeMatrix({ quickWins: [low, high, medium] }));

    expect(roadmap.phases[0]?.items.map((item) => item.id)).toEqual(["high", "medium", "low"]);
  });

  it("does not mutate the original matrix arrays while sorting", () => {
    const low = makeItem({ id: "low", priorityScore: 1 });
    const high = makeItem({ id: "high", priorityScore: 5 });
    const quickWins = [low, high];

    builder.build(makeMatrix({ quickWins }));

    expect(quickWins).toEqual([low, high]);
  });
});
