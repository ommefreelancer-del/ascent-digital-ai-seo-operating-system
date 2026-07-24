// The default ContentGenerationProvider: honestly reports that no real
// generated prose is available, rather than fabricating any. This is what
// SeoContentAgent.create() uses until a real provider (an approved LLM
// integration) is deliberately wired in and approved per GLOBAL_RULES.md
// SS9 ("connecting external services" requires human approval).

import type {
  ContentGenerationProvider,
  ContentGenerationRequest,
  GeneratedSection,
} from "../types/content-generation-provider.types.js";

export class NullContentGenerationProvider implements ContentGenerationProvider {
  readonly name = "none-configured";

  async generateSection(_request: ContentGenerationRequest): Promise<GeneratedSection | null> {
    return null;
  }
}
