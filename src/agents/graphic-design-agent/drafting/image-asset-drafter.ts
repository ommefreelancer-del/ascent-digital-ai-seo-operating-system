// Drafts one design brief's image via the injected ImageGenerationProvider,
// and assembles the full DesignAsset. With no provider configured (the
// default), or when the provider cannot produce a real image for this
// brief, the asset reference is a bracketed placeholder instruction --
// never a fabricated image standing in for a real design. Every asset
// requires approval before publication, per GLOBAL_RULES.md SS9 -- this
// agent never publishes anything itself.

import type { ImageGenerationProvider } from "../types/image-generation-provider.types.js";
import type { DesignAsset, DesignBrief } from "../types/graphic-design-request.types.js";

export class ImageAssetDrafter {
  async draftAsset(provider: ImageGenerationProvider, brief: DesignBrief): Promise<DesignAsset> {
    const generated = await provider.generateImage({
      title: brief.title,
      description: brief.description,
      graphicType: brief.graphicType,
      dimensions: brief.dimensions,
    });

    if (generated) {
      return { ...brief, assetReference: generated.assetReference, isGenerated: true, requiresApproval: true };
    }

    return {
      ...brief,
      assetReference:
        `[Image not generated -- no ImageGenerationProvider is configured. Design "${brief.title}" at ` +
        `${brief.dimensions}, matching: ${brief.description}]`,
      isGenerated: false,
      requiresApproval: true,
    };
  }
}
