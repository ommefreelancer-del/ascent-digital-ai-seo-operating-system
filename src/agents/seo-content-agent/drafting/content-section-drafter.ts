// Drafts one section's body via the injected ContentGenerationProvider.
// With no provider configured (the default), or when the provider cannot
// produce real prose for this section, the body is a bracketed placeholder
// instruction -- never fabricated prose standing in for a real draft.

import type { ContentGenerationProvider } from "../types/content-generation-provider.types.js";
import type { ContentSectionDraft } from "../types/seo-content-request.types.js";

export class ContentSectionDrafter {
  async draftSection(
    provider: ContentGenerationProvider,
    title: string,
    targetKeyword: string,
    heading: string,
    brandGuidelines: string | null,
  ): Promise<ContentSectionDraft> {
    const generated = await provider.generateSection({ title, targetKeyword, heading, brandGuidelines });
    if (generated) {
      return { heading, body: generated.body, isGenerated: true };
    }
    return {
      heading,
      body:
        `[Body content not generated -- no ContentGenerationProvider is configured. Draft this section ` +
        `("${heading}") covering "${targetKeyword}", matching the brief's classified search intent.]`,
      isGenerated: false,
    };
  }
}
