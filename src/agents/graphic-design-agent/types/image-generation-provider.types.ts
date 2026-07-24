// The seam between "the agent needs a real, publication-ready graphic" and
// "where that graphic actually comes from". This build has zero runtime
// dependencies and never calls an external service -- GLOBAL_RULES.md SS9
// requires explicit human approval before "connecting external services"
// (Canva, Adobe Photoshop/Illustrator, Figma, Photopea, or an image-
// generation API, per this agent's own spec). No concrete provider ships
// in this build -- only the interface and a NullImageGenerationProvider
// that honestly reports "unavailable" (see
// providers/null-image-generation-provider.ts). This agent never publishes
// or uploads a graphic itself, in this build or any future one -- a real
// provider wired in later would still only ever produce an asset for human
// review.

export interface ImageGenerationRequest {
  readonly title: string;
  readonly description: string;
  readonly graphicType: string;
  readonly dimensions: string;
}

/** A real, generated image asset. Never fabricated locally. */
export interface GeneratedImageAsset {
  readonly assetReference: string;
  readonly format: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  /**
   * Resolves to a real, generated image asset for the requested graphic, or
   * `null` if generation is unavailable (no provider configured,
   * generation failed, etc). Implementations must never invent a
   * placeholder asset here -- `null` is always the correct response when a
   * real image cannot be produced.
   */
  generateImage(request: ImageGenerationRequest): Promise<GeneratedImageAsset | null>;
}
