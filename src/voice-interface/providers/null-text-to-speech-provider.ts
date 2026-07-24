// The default TextToSpeechProvider: honestly reports that no real speech
// synthesis is available, rather than fabricating audio. This is what
// VoiceInterface.create() uses until a real provider (OpenAI Speech API,
// Azure AI Speech, Google Cloud Speech, ElevenLabs, etc.) is deliberately
// wired in and approved per GLOBAL_RULES.md SS9 ("connecting external
// services" requires human approval).

import type { AudioOutput, SpeechSynthesisRequest, TextToSpeechProvider } from "../types/voice-interface.types.js";

export class NullTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "none-configured";

  async synthesize(_request: SpeechSynthesisRequest): Promise<AudioOutput | null> {
    return null;
  }
}
