import { describe, expect, it } from "vitest";
import { ImageAssetDrafter } from "../../../../src/agents/graphic-design-agent/drafting/image-asset-drafter.js";
import { NullImageGenerationProvider } from "../../../../src/agents/graphic-design-agent/providers/null-image-generation-provider.js";
import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "../../../../src/agents/graphic-design-agent/types/image-generation-provider.types.js";
import type { DesignBrief } from "../../../../src/agents/graphic-design-agent/types/graphic-design-request.types.js";

class FixedImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly asset: GeneratedImageAsset | null) {}
  async generateImage(_request: ImageGenerationRequest): Promise<GeneratedImageAsset | null> {
    return this.asset;
  }
}

function makeBrief(overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    graphicType: "blog-featured-image",
    title: "Featured image for Emergency Plumbing Guide",
    description: "A featured image about emergency plumbing.",
    dimensions: "1200x630",
    altText: "Emergency plumbing featured image.",
    brandConsistencyNotes: "No brand guidelines were supplied.",
    source: "content-brief",
    ...overrides,
  };
}

describe("ImageAssetDrafter", () => {
  const drafter = new ImageAssetDrafter();

  it("produces a bracketed placeholder when the provider returns no real image", async () => {
    const asset = await drafter.draftAsset(new NullImageGenerationProvider(), makeBrief());

    expect(asset.isGenerated).toBe(false);
    expect(asset.assetReference).toMatch(/^\[.*\]$/);
    expect(asset.assetReference).toContain("Featured image for Emergency Plumbing Guide");
    expect(asset.requiresApproval).toBe(true);
  });

  it("uses the provider's real generated image when it supplies one", async () => {
    const provider = new FixedImageGenerationProvider({ assetReference: "https://cdn.example.com/asset.png", format: "png" });
    const asset = await drafter.draftAsset(provider, makeBrief());

    expect(asset.isGenerated).toBe(true);
    expect(asset.assetReference).toBe("https://cdn.example.com/asset.png");
    expect(asset.requiresApproval).toBe(true);
  });

  it("preserves every field from the brief unchanged", async () => {
    const brief = makeBrief({ title: "X", dimensions: "1080x1080" });
    const asset = await drafter.draftAsset(new NullImageGenerationProvider(), brief);

    expect(asset.title).toBe("X");
    expect(asset.dimensions).toBe("1080x1080");
    expect(asset.graphicType).toBe("blog-featured-image");
  });
});
