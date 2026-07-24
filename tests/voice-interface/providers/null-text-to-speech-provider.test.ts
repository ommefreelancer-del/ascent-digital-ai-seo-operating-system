import { describe, expect, it } from "vitest";
import { NullTextToSpeechProvider } from "../../../src/voice-interface/providers/null-text-to-speech-provider.js";

describe("NullTextToSpeechProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullTextToSpeechProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never fabricated audio", async () => {
    const provider = new NullTextToSpeechProvider();
    const result = await provider.synthesize({ text: "Hello", language: "en" });
    expect(result).toBeNull();
  });
});
