import { describe, expect, it } from "vitest";
import { NullImageGenerationProvider } from "../../../../src/agents/graphic-design-agent/providers/null-image-generation-provider.js";

describe("NullImageGenerationProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullImageGenerationProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated image", async () => {
    const provider = new NullImageGenerationProvider();
    const result = await provider.generateImage({
      title: "Featured image",
      description: "A plumbing guide featured image.",
      graphicType: "blog-featured-image",
      dimensions: "1200x630",
    });
    expect(result).toBeNull();
  });
});
