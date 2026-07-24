// The default PublisherQualityProvider: honestly reports that no real
// publisher quality evidence is available, rather than fabricating any.
// This is what PublisherQualificationAgent.create() uses until a real
// provider (an approved SEO tool with domain authority/spam-score data) is
// deliberately wired in and approved per GLOBAL_RULES.md SS9 ("connecting
// external services" requires human approval).

import type {
  PublisherQualityProvider,
  PublisherQualityRequest,
  PublisherQualitySnapshot,
} from "../types/publisher-quality-provider.types.js";

export class NullPublisherQualityProvider implements PublisherQualityProvider {
  readonly name = "none-configured";

  async fetchPublisherQuality(_request: PublisherQualityRequest): Promise<PublisherQualitySnapshot | null> {
    return null;
  }
}
