import { describe, expect, it } from "vitest";
import { NullContentGenerationProvider } from "../../../../src/agents/seo-content-agent/providers/null-content-generation-provider.js";

describe("NullContentGenerationProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullContentGenerationProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never fabricated prose", async () => {
    const provider = new NullContentGenerationProvider();
    const result = await provider.generateSection({
      title: "Emergency Plumbing Guide",
      targetKeyword: "emergency plumber",
      heading: "Introduction",
      brandGuidelines: null,
    });
    expect(result).toBeNull();
  });
});
