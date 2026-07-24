import { describe, expect, it } from "vitest";
import { ContentSectionDrafter } from "../../../../src/agents/seo-content-agent/drafting/content-section-drafter.js";
import { NullContentGenerationProvider } from "../../../../src/agents/seo-content-agent/providers/null-content-generation-provider.js";
import type {
  ContentGenerationProvider,
  ContentGenerationRequest,
  GeneratedSection,
} from "../../../../src/agents/seo-content-agent/types/content-generation-provider.types.js";

class FixedContentGenerationProvider implements ContentGenerationProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly section: GeneratedSection | null) {}
  async generateSection(_request: ContentGenerationRequest): Promise<GeneratedSection | null> {
    return this.section;
  }
}

describe("ContentSectionDrafter", () => {
  const drafter = new ContentSectionDrafter();

  it("produces a bracketed placeholder body when the provider returns no real prose", async () => {
    const section = await drafter.draftSection(
      new NullContentGenerationProvider(),
      "Emergency Plumbing Guide",
      "emergency plumber",
      "Introduction",
      null,
    );

    expect(section.isGenerated).toBe(false);
    expect(section.body).toMatch(/^\[.*\]$/);
    expect(section.body).toContain("Introduction");
    expect(section.body).toContain("emergency plumber");
    expect(section.heading).toBe("Introduction");
  });

  it("uses the provider's real generated prose when it supplies one", async () => {
    const provider = new FixedContentGenerationProvider({
      heading: "Introduction",
      body: "Emergency plumbing issues require fast, reliable response.",
    });

    const section = await drafter.draftSection(provider, "Emergency Plumbing Guide", "emergency plumber", "Introduction", null);

    expect(section.isGenerated).toBe(true);
    expect(section.body).toBe("Emergency plumbing issues require fast, reliable response.");
  });
});
