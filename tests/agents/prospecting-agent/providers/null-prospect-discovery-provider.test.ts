import { describe, expect, it } from "vitest";
import { NullProspectDiscoveryProvider } from "../../../../src/agents/prospecting-agent/providers/null-prospect-discovery-provider.js";

describe("NullProspectDiscoveryProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullProspectDiscoveryProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated candidate", async () => {
    const provider = new NullProspectDiscoveryProvider();
    const result = await provider.discoverProspects({
      campaignRequirements: "Find plumbing guest post opportunities.",
      targetNiche: "plumbing",
      targetCountry: "US",
      targetLanguage: "en",
    });
    expect(result).toBeNull();
  });
});
