import { describe, expect, it } from "vitest";
import { NullGbpDataProvider } from "../../../../src/agents/google-business-profile-agent/providers/null-gbp-data-provider.js";

describe("NullGbpDataProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullGbpDataProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullGbpDataProvider();
    const result = await provider.fetchGbpSnapshot({ businessName: "Acme Plumbing", websiteUrl: "https://oursite.com" });
    expect(result).toBeNull();
  });
});
