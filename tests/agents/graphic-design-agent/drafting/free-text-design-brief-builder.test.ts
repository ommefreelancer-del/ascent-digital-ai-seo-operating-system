import { describe, expect, it } from "vitest";
import { FreeTextDesignBriefBuilder } from "../../../../src/agents/graphic-design-agent/drafting/free-text-design-brief-builder.js";

describe("FreeTextDesignBriefBuilder", () => {
  const builder = new FreeTextDesignBriefBuilder();

  it("returns no briefs for an empty list", () => {
    expect(builder.build([], "marketing-requirement", () => "marketing-asset", null)).toEqual([]);
  });

  it("builds one brief per real, caller-supplied text with the resolved graphic type", () => {
    const [brief] = builder.build(["Trade show flyer"], "marketing-requirement", () => "marketing-asset", null);
    expect(brief).toMatchObject({ graphicType: "marketing-asset", source: "marketing-requirement", dimensions: "1080x1350" });
    expect(brief?.description).toBe("Trade show flyer");
    expect(brief?.title).toContain("Trade show flyer");
  });

  it("uses the resolver function to pick a different graphic type per text", () => {
    const resolver = (text: string) => (text.includes("thumbnail") ? ("youtube-thumbnail" as const) : ("marketing-asset" as const));
    const briefs = builder.build(["A YouTube thumbnail", "A flyer"], "design-request", resolver, null);
    expect(briefs[0]?.graphicType).toBe("youtube-thumbnail");
    expect(briefs[1]?.graphicType).toBe("marketing-asset");
  });

  it("echoes real brand guidelines when supplied", () => {
    const [brief] = builder.build(["A flyer"], "marketing-requirement", () => "marketing-asset", "Bold, playful tone.");
    expect(brief?.brandConsistencyNotes).toContain("Bold, playful tone.");
  });
});
