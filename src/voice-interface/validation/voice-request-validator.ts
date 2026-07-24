// Structural validation for an incoming VoiceRequest. A blank real audio
// payload throws immediately, per GLOBAL_RULES.md SS11 -- this module never
// guesses at what a missing recording might have contained.

import type { VoiceRequest } from "../types/voice-interface.types.js";

export class VoiceRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceRequestValidationError";
  }
}

export class VoiceRequestValidator {
  validate(request: VoiceRequest): void {
    if (!request.audio.data.trim()) {
      throw new VoiceRequestValidationError("audio.data must not be empty.");
    }
    if (!request.audio.mimeType.trim()) {
      throw new VoiceRequestValidationError("audio.mimeType must not be empty.");
    }
  }
}
