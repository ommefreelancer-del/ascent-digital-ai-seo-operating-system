import { describe, expect, it } from "vitest";
import { extractQuotedPrice } from "../../../../src/agents/reply-negotiation-agent/negotiation/price-extractor.js";

describe("extractQuotedPrice", () => {
  it("returns null when no real price pattern exists in the text", () => {
    expect(extractQuotedPrice("Thanks for reaching out, let me check with my team.")).toBeNull();
  });

  it("extracts a real whole-dollar price", () => {
    const result = extractQuotedPrice("Sure, we can do this for $150 per post.");
    expect(result?.price).toBe(150);
  });

  it("extracts a real price with cents", () => {
    const result = extractQuotedPrice("Our rate is $149.99 for a guest post.");
    expect(result?.price).toBe(149.99);
  });

  it("includes real surrounding context in rawText", () => {
    const result = extractQuotedPrice("Sure, we can do this for $150 per post, let us know.");
    expect(result?.rawText).toContain("$150");
  });

  it("extracts the first real price when multiple are present", () => {
    const result = extractQuotedPrice("We usually charge $300 but can offer $150 for a first collaboration.");
    expect(result?.price).toBe(300);
  });
});
