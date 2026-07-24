import { describe, expect, it } from "vitest";
import { NullBacklinkDataProvider } from "../../../../src/agents/off-page-seo-agent/providers/null-backlink-data-provider.js";

describe("NullBacklinkDataProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullBacklinkDataProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullBacklinkDataProvider();
    const result = await provider.fetchBacklinkProfile({ url: "https://oursite.com/plumbing" });
    expect(result).toBeNull();
  });
});
