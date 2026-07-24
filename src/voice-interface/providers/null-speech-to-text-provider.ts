// The default SpeechToTextProvider: honestly reports that no real speech
// recognition is available, rather than fabricating a transcript. This is
// what VoiceInterface.create() uses until a real provider (OpenAI Speech
// API, Azure AI Speech, Google Cloud Speech, Deepgram, AssemblyAI, etc.) is
// deliberately wired in and approved per GLOBAL_RULES.md SS9 ("connecting
// external services" requires human approval).

import type { AudioInput, SpeechToTextProvider, TranscriptionResult } from "../types/voice-interface.types.js";

export class NullSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "none-configured";

  async transcribe(_audio: AudioInput): Promise<TranscriptionResult | null> {
    return null;
  }
}
