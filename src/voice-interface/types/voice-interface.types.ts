// Input/output shapes for the Voice Interface, per
// docs/architecture/VoiceInterface.md. This module never communicates with
// specialist agents or the Boss Agent directly -- every voice request is
// converted to text and forwarded through the injected ConversationGateway
// (a real ConversationLanguageManager in production), exactly as the
// architecture doc's "Voice Processing Workflow" requires. Speech-to-text
// and text-to-speech both go through pluggable providers with honest Null
// defaults (see providers/), so recognition results and audio are never
// fabricated when no real provider is configured.

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";
import type { ConversationIntent, SupportedLanguage } from "../../conversation-language-manager/types/conversation.types.js";
import type { TaskPriority } from "../../boss-agent/types/task.types.js";

/** A real, caller-supplied audio reference (e.g. a base64 payload). Never decoded or interpreted here. */
export interface AudioInput {
  readonly data: string;
  readonly mimeType: string;
}

export interface TranscriptionResult {
  readonly text: string;
  /** Real confidence (0-1), as reported by the provider. Never inferred locally. */
  readonly confidence: number;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  /**
   * Resolves to the real transcription of `audio`, or `null` if no data is
   * available (no provider configured, recognition failed, etc).
   * Implementations must never invent a transcript -- `null` is always the
   * correct response when genuine recognition cannot be obtained.
   */
  transcribe(audio: AudioInput): Promise<TranscriptionResult | null>;
}

export interface AudioOutput {
  readonly data: string;
  readonly mimeType: string;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
}

export interface SpeechSynthesisRequest {
  readonly text: string;
  readonly language: SupportedLanguage;
}

export interface TextToSpeechProvider {
  readonly name: string;
  /**
   * Resolves to real synthesized audio for `request.text`, or `null` if no
   * data is available (no provider configured, synthesis failed, etc).
   * Implementations must never invent audio -- `null` is always the correct
   * response when genuine synthesis cannot be obtained.
   */
  synthesize(request: SpeechSynthesisRequest): Promise<AudioOutput | null>;
}

/**
 * The minimal surface this module needs from the Conversation & Language
 * Manager, per the architecture doc's own rule "never communicates directly
 * with specialist agents". Depending on this interface (rather than the
 * concrete class) keeps this module's own tests independent of a real
 * BossAgentGateway. A real `ConversationLanguageManager` instance satisfies
 * this structurally, unchanged.
 */
export interface ConversationGateway {
  handleMessage(request: {
    readonly sessionId: string;
    readonly message: string;
    readonly languageOverride?: SupportedLanguage;
    readonly priority?: TaskPriority;
  }): Promise<{
    readonly sessionId: string;
    readonly language: SupportedLanguage;
    readonly intent: ConversationIntent;
    readonly reply: string;
    readonly routingDecision: RoutingDecision | null;
    readonly decidedAt: string;
  }>;
}

export interface VoiceRequest {
  readonly sessionId: string;
  readonly audio: AudioInput;
  readonly languageOverride?: SupportedLanguage;
  readonly priority?: TaskPriority;
}

export interface VoiceResponse {
  readonly sessionId: string;
  /** True only when a real SpeechToTextProvider produced a transcript. */
  readonly dataAvailable: boolean;
  readonly transcript: string | null;
  readonly replyText: string | null;
  /** `null` when no real TextToSpeechProvider is configured; the reply is still available as `replyText`. */
  readonly replyAudio: AudioOutput | null;
  readonly routingDecision: RoutingDecision | null;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
