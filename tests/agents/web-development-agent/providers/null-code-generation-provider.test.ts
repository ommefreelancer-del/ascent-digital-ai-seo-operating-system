import { describe, expect, it } from "vitest";
import { NullCodeGenerationProvider } from "../../../../src/agents/web-development-agent/providers/null-code-generation-provider.js";

describe("NullCodeGenerationProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullCodeGenerationProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never fabricated code", async () => {
    const provider = new NullCodeGenerationProvider();
    const result = await provider.generateCodeSnippet({
      taskTitle: "Fix broken link",
      taskDescription: "The contact link is broken.",
      language: "html",
    });
    expect(result).toBeNull();
  });
});
