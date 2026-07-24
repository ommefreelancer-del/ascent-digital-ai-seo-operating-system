import { describe, expect, it } from "vitest";
import {
  VoiceRequestValidationError,
  VoiceRequestValidator,
} from "../../../src/voice-interface/validation/voice-request-validator.js";
import type { VoiceRequest } from "../../../src/voice-interface/types/voice-interface.types.js";

function makeRequest(overrides: Partial<VoiceRequest> = {}): VoiceRequest {
  return { sessionId: "session-1", audio: { data: "base64-audio-data", mimeType: "audio/wav" }, ...overrides };
}

describe("VoiceRequestValidator", () => {
  const validator = new VoiceRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when audio.data is blank", () => {
    expect(() => validator.validate(makeRequest({ audio: { data: "   ", mimeType: "audio/wav" } }))).toThrow(
      VoiceRequestValidationError,
    );
  });

  it("throws when audio.mimeType is blank", () => {
    expect(() => validator.validate(makeRequest({ audio: { data: "base64-audio-data", mimeType: "   " } }))).toThrow(
      VoiceRequestValidationError,
    );
  });
});
