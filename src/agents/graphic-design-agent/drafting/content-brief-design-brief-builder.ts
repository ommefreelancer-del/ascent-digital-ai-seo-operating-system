// Translates each real, already-computed ContentBrief from the Content
// Strategy Agent into a blog-featured-image design brief -- every piece of
// planned content needs an accompanying visual, and this agent never
// re-derives the topic or keyword itself, only the visual brief around it.

import type { ContentBrief } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import type { DesignBrief } from "../types/graphic-design-request.types.js";
import { DIMENSIONS_BY_GRAPHIC_TYPE } from "./graphic-dimensions.js";

export class ContentBriefDesignBriefBuilder {
  build(contentBriefs: readonly ContentBrief[], brandGuidelines: string | null): DesignBrief[] {
    return contentBriefs.map((brief) => ({
      graphicType: "blog-featured-image",
      title: `Featured image for "${brief.title}"`,
      description: `A featured image representing "${brief.title}", targeting the keyword "${brief.targetKeyword}".`,
      dimensions: DIMENSIONS_BY_GRAPHIC_TYPE["blog-featured-image"],
      altText: `${brief.title} -- illustrative featured image for the topic "${brief.targetKeyword}".`,
      brandConsistencyNotes: brandConsistencyNotesFor(brandGuidelines),
      source: "content-brief",
    }));
  }
}

function brandConsistencyNotesFor(brandGuidelines: string | null): string {
  return brandGuidelines
    ? `Align with supplied brand guidelines: ${brandGuidelines}`
    : "No brand guidelines were supplied; use general professional, brand-neutral styling.";
}
