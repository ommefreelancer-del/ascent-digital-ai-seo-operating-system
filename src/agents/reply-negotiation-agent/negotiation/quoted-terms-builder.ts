// Builds real QuotedTerms from real replies -- per the spec's "Extract
// quoted prices and terms" responsibility. Checks the most recent replies
// first (a later reply's price supersedes an earlier one in the same real
// conversation); returns "not-quoted" with null fields when no real price
// was ever mentioned, rather than guessing one.

import { extractQuotedPrice } from "./price-extractor.js";
import type { RawPublisherReply } from "../types/publisher-reply-provider.types.js";
import type { QuotedTerms } from "../types/reply-negotiation-request.types.js";

export class QuotedTermsBuilder {
  build(domain: string, replies: readonly RawPublisherReply[]): QuotedTerms {
    const mostRecentFirst = [...replies].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    for (const reply of mostRecentFirst) {
      const extracted = extractQuotedPrice(reply.messageText);
      if (extracted) {
        return { domain, status: "quoted", quotedPrice: extracted.price, rawQuoteText: extracted.rawText };
      }
    }

    return { domain, status: "not-quoted", quotedPrice: null, rawQuoteText: null };
  }
}
