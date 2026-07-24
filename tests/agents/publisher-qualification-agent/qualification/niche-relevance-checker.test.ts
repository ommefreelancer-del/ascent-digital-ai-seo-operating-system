import { describe, expect, it } from "vitest";
import { isNicheTextMatch } from "../../../../src/agents/publisher-qualification-agent/qualification/niche-relevance-checker.js";
import type { Prospect } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Blog",
    category: "guest-post",
    confidence: "high",
    notes: "A general blog.",
    ...overrides,
  };
}

describe("isNicheTextMatch", () => {
  it("matches when the real niche appears in the prospect's title", () => {
    expect(isNicheTextMatch(makeProspect({ title: "The Plumbing Weekly Blog" }), "plumbing")).toBe(true);
  });

  it("matches when the real niche appears in the prospect's notes", () => {
    expect(isNicheTextMatch(makeProspect({ notes: "Covers plumbing and HVAC topics." }), "plumbing")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isNicheTextMatch(makeProspect({ title: "PLUMBING Weekly" }), "plumbing")).toBe(true);
  });

  it("does not match when the niche is absent from both title and notes", () => {
    expect(isNicheTextMatch(makeProspect({ title: "Cooking Blog", notes: "Recipes and reviews." }), "plumbing")).toBe(false);
  });
});
