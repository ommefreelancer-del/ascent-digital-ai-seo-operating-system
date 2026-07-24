// The default ImageGenerationProvider: honestly reports that no real image
// generation is available, rather than fabricating any. This is what
// GraphicDesignAgent.create() uses until a real provider (an approved
// design-tool or image-generation integration) is deliberately wired in
// and approved per GLOBAL_RULES.md SS9 ("connecting external services"
// requires human approval).

import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "../types/image-generation-provider.types.js";

export class NullImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "none-configured";

  async generateImage(_request: ImageGenerationRequest): Promise<GeneratedImageAsset | null> {
    return null;
  }
}
