import { describe, expect, it } from "vitest";
import { NullContactDiscoveryProvider } from "../../../../src/agents/contact-intelligence-agent/providers/null-contact-discovery-provider.js";

describe("NullContactDiscoveryProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullContactDiscoveryProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullContactDiscoveryProvider();
    const result = await provider.discoverContacts({ domain: "example.com", url: "https://example.com" });
    expect(result).toBeNull();
  });
});
