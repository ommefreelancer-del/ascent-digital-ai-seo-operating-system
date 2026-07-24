// Extracts the real referring domains a BacklinkDataProvider's own toxicity
// analysis flagged. This builder never performs its own toxicity judgment --
// it only surfaces what the provider already determined, per
// GLOBAL_RULES.md SS2 (never invent a value the provider didn't supply).

import type { BacklinkProfile } from "../types/backlink-data-provider.types.js";
import type { ToxicBacklinkInsight } from "../types/off-page-seo-request.types.js";

export class ToxicBacklinkInsightBuilder {
  build(profile: BacklinkProfile | null): ToxicBacklinkInsight[] {
    if (!profile) {
      return [];
    }
    return profile.referringDomains
      .filter((referringDomain) => referringDomain.isToxic)
      .map((referringDomain) => ({
        domain: referringDomain.domain,
        linkingUrl: referringDomain.linkingUrl,
        anchorText: referringDomain.anchorText,
      }));
  }
}
