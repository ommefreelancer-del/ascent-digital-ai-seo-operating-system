import { describe, expect, it } from "vitest";
import { PrioritizationMatrixBuilder } from "../../../../src/agents/seo-strategy-agent/synthesis/prioritization-matrix-builder.js";
import type { StrategyItem } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";

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
    priorityScore: 3,
    ...overrides,
  };
}

describe("PrioritizationMatrixBuilder", () => {
  const builder = new PrioritizationMatrixBuilder();

  it("classifies high-impact, low-effort items as quick wins", () => {
    const matrix = builder.build([makeItem({ impact: "high", effort: "low" })]);
    expect(matrix.quickWins).toHaveLength(1);
    expect(matrix.majorProjects).toHaveLength(0);
    expect(matrix.fillIns).toHaveLength(0);
    expect(matrix.thankless).toHaveLength(0);
  });

  it("classifies medium-impact, low-effort items as quick wins too", () => {
    const matrix = builder.build([makeItem({ impact: "medium", effort: "low" })]);
    expect(matrix.quickWins).toHaveLength(1);
  });

  it("classifies high-impact, high-effort items as major projects", () => {
    const matrix = builder.build([makeItem({ impact: "high", effort: "high" })]);
    expect(matrix.majorProjects).toHaveLength(1);
  });

  it("classifies low-impact, low-effort items as fill-ins", () => {
    const matrix = builder.build([makeItem({ impact: "low", effort: "low" })]);
    expect(matrix.fillIns).toHaveLength(1);
  });

  it("classifies low-impact, high-effort items as thankless", () => {
    const matrix = builder.build([makeItem({ impact: "low", effort: "high" })]);
    expect(matrix.thankless).toHaveLength(1);
  });

  it("classifies low-impact, medium-effort items as thankless (not low-effort)", () => {
    const matrix = builder.build([makeItem({ impact: "low", effort: "medium" })]);
    expect(matrix.thankless).toHaveLength(1);
  });

  it("returns empty quadrants for an empty item list", () => {
    const matrix = builder.build([]);
    expect(matrix.quickWins).toHaveLength(0);
    expect(matrix.majorProjects).toHaveLength(0);
    expect(matrix.fillIns).toHaveLength(0);
    expect(matrix.thankless).toHaveLength(0);
  });
});
