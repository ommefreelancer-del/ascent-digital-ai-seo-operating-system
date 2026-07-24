// Classifies a real, caller-supplied design request into a GraphicType by
// real keyword signals in its own text -- a documented categorization
// heuristic (mirroring the same convention used elsewhere in this codebase,
// e.g. Off-Page SEO's effort-by-category convention), not a fabricated
// judgment about design intent. Falls back to "marketing-asset" as the
// generic catch-all when no more specific signal is present.

import type { GraphicType } from "../types/graphic-design-request.types.js";

export function classifyDesignRequest(text: string): GraphicType {
  if (/youtube|thumbnail/i.test(text)) {
    return "youtube-thumbnail";
  }
  if (/social media|instagram|facebook|twitter|linkedin|tiktok/i.test(text)) {
    return "social-media-graphic";
  }
  if (/infographic/i.test(text)) {
    return "infographic";
  }
  if (/website|web page|landing page/i.test(text)) {
    return "website-graphic";
  }
  return "marketing-asset";
}
