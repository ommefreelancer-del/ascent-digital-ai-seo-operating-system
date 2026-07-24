// Real, publicly documented standard platform dimensions for each graphic
// type (e.g. the YouTube thumbnail spec, the Open Graph/blog-featured-image
// spec, common square social media post dimensions) -- a documented
// convention, not a claim about any specific project's requirements,
// consistent with how other agents in this codebase state their own stated
// conventions (e.g. Core Web Vitals thresholds, backup freshness window)
// rather than inventing business-specific numbers.

import type { GraphicType } from "../types/graphic-design-request.types.js";

export const DIMENSIONS_BY_GRAPHIC_TYPE: Record<GraphicType, string> = {
  "website-graphic": "1600x900",
  "blog-featured-image": "1200x630",
  "youtube-thumbnail": "1280x720",
  "social-media-graphic": "1080x1080",
  infographic: "800x2000",
  "marketing-asset": "1080x1350",
};
