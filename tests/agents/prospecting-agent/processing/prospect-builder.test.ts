import { describe, expect, it } from "vitest";
import { ProspectBuilder } from "../../../../src/agents/prospecting-agent/processing/prospect-builder.js";
import type { RawProspectCandidate } from "../../../../src/agents/prospecting-agent/types/prospect-discovery-provider.types.js";

function makeCandidate(overrides: Partial<RawProspectCandidate> = {}): RawProspectCandidate {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Blog",
    snippet: "A blog about plumbing.",
    opportunityType: "guest-post",
    relevanceScore: 0.5,
    ...overrides,
  };
}

describe("ProspectBuilder", () => {
  const builder = new ProspectBuilder();

  it("returns no prospects for an empty candidate list", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("passes through the real category unchanged", () => {
    const [prospect] = builder.build([makeCandidate({ opportunityType: "backlink" })]);
    expect(prospect?.category).toBe("backlink");
  });

  it("assigns high confidence at or above the real 0.7 threshold", () => {
    const [prospect] = builder.build([makeCandidate({ relevanceScore: 0.7 })]);
    expect(prospect?.confidence).toBe("high");
  });

  it("assigns medium confidence between the real 0.4 and 0.7 thresholds", () => {
    const [prospect] = builder.build([makeCandidate({ relevanceScore: 0.5 })]);
    expect(prospect?.confidence).toBe("medium");
  });

  it("assigns low confidence below the real 0.4 threshold", () => {
    const [prospect] = builder.build([makeCandidate({ relevanceScore: 0.1 })]);
    expect(prospect?.confidence).toBe("low");
  });

  it("includes the real title, snippet, and relevance score in the notes", () => {
    const [prospect] = builder.build([makeCandidate({ title: "Plumbing Weekly", snippet: "Industry news.", relevanceScore: 0.9 })]);
    expect(prospect?.notes).toContain("Plumbing Weekly");
    expect(prospect?.notes).toContain("Industry news.");
    expect(prospect?.notes).toContain("0.9");
  });
});
