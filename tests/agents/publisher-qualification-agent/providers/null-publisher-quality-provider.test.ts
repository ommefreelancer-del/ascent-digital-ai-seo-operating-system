import { describe, expect, it } from "vitest";
import { NullPublisherQualityProvider } from "../../../../src/agents/publisher-qualification-agent/providers/null-publisher-quality-provider.js";

describe("NullPublisherQualityProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullPublisherQualityProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullPublisherQualityProvider();
    const result = await provider.fetchPublisherQuality({ domain: "example.com", url: "https://example.com" });
    expect(result).toBeNull();
  });
});
