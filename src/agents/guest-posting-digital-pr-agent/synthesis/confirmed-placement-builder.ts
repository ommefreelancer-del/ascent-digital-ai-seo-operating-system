// Builds real confirmed placements -- per the spec's "Monitor confirmed
// guest post/backlink placements" responsibility. A direct echo of the
// Reply & Negotiation Agent's own real, human-confirmed pricing agreements
// (see FinalAgreedPrice) -- this agent never invents a placement, and never
// claims a live backlink was crawled, since no real crawl data source
// exists in this build.

import type { FinalAgreedPrice } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { ConfirmedPlacement } from "../types/guest-posting-digital-pr-request.types.js";

export class ConfirmedPlacementBuilder {
  build(finalAgreedPricing: readonly FinalAgreedPrice[]): ConfirmedPlacement[] {
    return finalAgreedPricing.map((price) => ({
      domain: price.domain,
      agreedPrice: price.agreedPrice,
      currency: price.currency,
      confirmedAt: price.confirmedAt,
    }));
  }
}
