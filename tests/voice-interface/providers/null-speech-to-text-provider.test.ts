import { describe, expect, it } from "vitest";
import { NullSpeechToTextProvider } from "../../../src/voice-interface/providers/null-speech-to-text-provider.js";

describe("NullSpeechToTextProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullSpeechToTextProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated transcript", async () => {
    const provider = new NullSpeechToTextProvider();
    const result = await provider.transcribe({ data: "base64-audio-data", mimeType: "audio/wav" });
    expect(result).toBeNull();
  });
});
