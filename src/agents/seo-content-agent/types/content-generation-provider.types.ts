// The seam between "the agent needs real, publication-ready prose" and
// "where that prose actually comes from". This build has zero runtime
// dependencies and never calls an external service -- GLOBAL_RULES.md SS9
// requires explicit human approval before "connecting external services",
// which a real LLM provider (ChatGPT, Claude, etc., per this agent's own
// spec) would be. No concrete provider ships in this build -- only the
// interface and a NullContentGenerationProvider that honestly reports
// "unavailable" (see providers/null-content-generation-provider.ts). A real
// provider can be plugged in later, once explicitly approved, without
// changing SeoContentAgent.

export interface ContentGenerationRequest {
  readonly title: string;
  readonly targetKeyword: string;
  /** The section heading to write body copy for. */
  readonly heading: string;
  /** Free-text brand voice/tone guidance, if the caller supplied any. */
  readonly brandGuidelines: string | null;
}

/** Real, generated prose for one section. Never fabricated locally. */
export interface GeneratedSection {
  readonly heading: string;
  readonly body: string;
}

export interface ContentGenerationProvider {
  readonly name: string;
  /**
   * Resolves to real, generated prose for the requested section, or `null`
   * if generation is unavailable (no provider configured, generation
   * failed, etc). Implementations must never invent placeholder prose here
   * -- `null` is always the correct response when real content cannot be
   * produced.
   */
  generateSection(request: ContentGenerationRequest): Promise<GeneratedSection | null>;
}
