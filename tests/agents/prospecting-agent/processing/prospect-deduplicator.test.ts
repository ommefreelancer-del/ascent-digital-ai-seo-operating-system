import { describe, expect, it } from "vitest";
import { ProspectDeduplicator } from "../../../../src/agents/prospecting-agent/processing/prospect-deduplicator.js";
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

describe("ProspectDeduplicator", () => {
  const deduplicator = new ProspectDeduplicator();

  it("returns all candidates unchanged when there are no duplicates", () => {
    const result = deduplicator.dedupe([makeCandidate({ domain: "a.com" }), makeCandidate({ domain: "b.com" })]);
    expect(result.deduped).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("removes a duplicate domain, keeping the higher real relevance score", () => {
    const low = makeCandidate({ domain: "example.com", relevanceScore: 0.3, title: "Low" });
    const high = makeCandidate({ domain: "example.com", relevanceScore: 0.8, title: "High" });
    const result = deduplicator.dedupe([low, high]);

    expect(result.deduped).toHaveLength(1);
    expect(result.deduped[0]?.title).toBe("High");
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("treats domains as case-insensitive duplicates", () => {
    const result = deduplicator.dedupe([makeCandidate({ domain: "Example.com" }), makeCandidate({ domain: "example.com" })]);
    expect(result.deduped).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("returns an empty list with zero duplicates removed for an empty input", () => {
    const result = deduplicator.dedupe([]);
    expect(result.deduped).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
  });
});
