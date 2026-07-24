// Turns real, caller-supplied free-text requests (marketing requirements,
// website requirements, or ad-hoc design requests) into design briefs,
// passed through verbatim -- this agent never invents what the request
// contains. The graphic type is resolved by a caller-supplied function so
// this one builder serves all three free-text sources: a constant type for
// marketing/website requirements, or the real keyword-based classifier for
// open-ended design requests.

import type { DesignBrief, DesignBriefSource, GraphicType } from "../types/graphic-design-request.types.js";
import { DIMENSIONS_BY_GRAPHIC_TYPE } from "./graphic-dimensions.js";

export type GraphicTypeResolver = (text: string) => GraphicType;

export class FreeTextDesignBriefBuilder {
  build(
    texts: readonly string[],
    source: DesignBriefSource,
    resolveGraphicType: GraphicTypeResolver,
    brandGuidelines: string | null,
  ): DesignBrief[] {
    return texts.map((text) => {
      const graphicType = resolveGraphicType(text);
      return {
        graphicType,
        title: `${titleFor(graphicType)}: ${text}`,
        description: text,
        dimensions: DIMENSIONS_BY_GRAPHIC_TYPE[graphicType],
        altText: `Accessible alt text describing: ${text}`,
        brandConsistencyNotes: brandGuidelines
          ? `Align with supplied brand guidelines: ${brandGuidelines}`
          : "No brand guidelines were supplied; use general professional, brand-neutral styling.",
        source,
      };
    });
  }
}

function titleFor(graphicType: GraphicType): string {
  return graphicType
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
