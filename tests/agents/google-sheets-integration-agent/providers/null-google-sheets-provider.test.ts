import { describe, expect, it } from "vitest";
import { NullGoogleSheetsProvider } from "../../../../src/agents/google-sheets-integration-agent/providers/null-google-sheets-provider.js";

describe("NullGoogleSheetsProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullGoogleSheetsProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullGoogleSheetsProvider();
    const result = await provider.fetchSheetSnapshot({ spreadsheetId: "sheet-123" });
    expect(result).toBeNull();
  });
});
