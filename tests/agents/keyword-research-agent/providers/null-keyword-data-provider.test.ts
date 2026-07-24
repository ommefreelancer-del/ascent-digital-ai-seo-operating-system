import { describe, expect, it } from "vitest";
import { NullKeywordDataProvider } from "../../../../src/agents/keyword-research-agent/providers/null-keyword-data-provider.js";

describe("NullKeywordDataProvider", () => {
  it("always resolves null instead of inventing metrics", async () => {
    const provider = new NullKeywordDataProvider();

    const result = await provider.fetchMetrics({ keyword: "anything" });

    expect(result).toBeNull();
  });

  it("exposes a stable, descriptive name for audit/limitation messages", () => {
    const provider = new NullKeywordDataProvider();
    expect(provider.name).toBe("none-configured");
  });
});
