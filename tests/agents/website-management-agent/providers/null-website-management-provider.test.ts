import { describe, expect, it } from "vitest";
import { NullWebsiteManagementProvider } from "../../../../src/agents/website-management-agent/providers/null-website-management-provider.js";

describe("NullWebsiteManagementProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullWebsiteManagementProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullWebsiteManagementProvider();
    const result = await provider.fetchWebsiteHealth({ url: "https://oursite.com" });
    expect(result).toBeNull();
  });
});
