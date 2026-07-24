// Input/output shapes for the Graphic Design Agent, per
// Agents/graphic-design-agent.md. Every design brief traces to a real
// input: "blog-featured-image" briefs relay the real, already-computed
// ContentBrief objects from the Content Strategy Agent (every piece of
// planned content needs an accompanying visual -- this agent's own real
// value-add); "marketing-asset", "website-graphic", and classified
// design-request briefs are caller-supplied real text, passed through
// verbatim, never fabricated. Dimensions are real, publicly documented
// standard platform sizes (e.g. the YouTube thumbnail spec, the Open Graph
// image spec), not a claim about any specific project's requirements. With
// no ImageGenerationProvider configured (the default), every asset
// reference is a bracketed placeholder instruction, never a fabricated
// image.

import type { ContentStrategyResult } from "../../content-strategy-agent/types/content-strategy-request.types.js";

export interface GraphicDesignRequest {
  readonly id: string;
  readonly contentStrategy: ContentStrategyResult;
  /** Optional free-text brand voice/style guidance. Echoed into every brief, never invented if omitted. */
  readonly brandGuidelines?: string;
  readonly marketingRequirements?: readonly string[];
  readonly websiteRequirements?: readonly string[];
  readonly designRequests?: readonly string[];
}

export type GraphicType =
  | "website-graphic"
  | "blog-featured-image"
  | "youtube-thumbnail"
  | "social-media-graphic"
  | "infographic"
  | "marketing-asset";

export type DesignBriefSource = "content-brief" | "marketing-requirement" | "website-requirement" | "design-request";

export interface DesignBrief {
  readonly graphicType: GraphicType;
  readonly title: string;
  readonly description: string;
  readonly dimensions: string;
  readonly altText: string;
  readonly brandConsistencyNotes: string;
  readonly source: DesignBriefSource;
}

export interface DesignAsset extends DesignBrief {
  /** Real generated image reference if a ImageGenerationProvider supplied it; otherwise a bracketed placeholder instruction. */
  readonly assetReference: string;
  /** True only when `assetReference` is a real, provider-generated asset. */
  readonly isGenerated: boolean;
  /** Always true in this build: publishing any graphic externally requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface GraphicDesignResult {
  readonly requestId: string;
  /** True only when at least one asset received a real, provider-generated image. */
  readonly dataAvailable: boolean;
  readonly designAssets: readonly DesignAsset[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
