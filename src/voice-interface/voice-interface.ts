// Voice Interface, per docs/architecture/VoiceInterface.md.
//
// Workflow (mirrors the architecture doc's "Voice Processing Workflow"):
//   1. Validate the request: a non-empty real audio payload.
//   2. Log "voice_message_received".
//   3. Transcribe the real audio through the injected SpeechToTextProvider.
//      With no provider configured (the default), this always resolves to
//      `null` -- a transcript is never fabricated to fill the gap. When
//      transcription is unavailable, this module returns immediately with
//      `dataAvailable: false` and never calls the Conversation & Language
//      Manager, since there is no real text to forward.
//   4. Forward the real transcript to the injected ConversationGateway (a
//      real ConversationLanguageManager in production) -- this module never
//      talks to the Boss Agent or any specialist agent directly.
//   5. Synthesize the real reply text through the injected
//      TextToSpeechProvider. With no provider configured, `replyAudio` is
//      `null` and the reply remains available as `replyText` -- text
//      interaction continues to work exactly as the architecture doc's own
//      Error Handling section requires ("Continue using text interaction if
//      required").
//   6. Log "voice_message_handled" and return.
//
// This module makes no approve/reject judgment call of its own -- the
// Conversation & Language Manager already handles prompt-injection
// escalation on the transcribed text, so no ApprovalChannel is wired here,
// matching the precedent set by the pure-aggregation specialist agents
// (e.g. CampaignTrackingAgent, AiCrmAgent).
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this module never invents a
// transcript, a recognition confidence, or synthesized audio. No external
// speech API is called anywhere in this module -- see
// providers/null-speech-to-text-provider.ts and
// providers/null-text-to-speech-provider.ts.

import { AuditLogger } from "../core/governance/audit-logger.js";
import type { VoiceInterfaceConfig } from "./config/voice-interface.config.js";
import { VoiceRequestValidator } from "./validation/voice-request-validator.js";
import { NullSpeechToTextProvider } from "./providers/null-speech-to-text-provider.js";
import { NullTextToSpeechProvider } from "./providers/null-text-to-speech-provider.js";
import type {
  ConversationGateway,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VoiceRequest,
  VoiceResponse,
} from "./types/voice-interface.types.js";

export class VoiceInterface {
  constructor(
    private readonly validator: VoiceRequestValidator,
    private readonly sttProvider: SpeechToTextProvider,
    private readonly ttsProvider: TextToSpeechProvider,
    private readonly conversationGateway: ConversationGateway,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullSpeechToTextProvider
   * and NullTextToSpeechProvider (no real speech providers configured),
   * matching how every other pluggable-provider agent in this codebase is
   * wired.
   */
  static async create(
    config: VoiceInterfaceConfig,
    conversationGateway: ConversationGateway,
    sttProvider: SpeechToTextProvider = new NullSpeechToTextProvider(),
    ttsProvider: TextToSpeechProvider = new NullTextToSpeechProvider(),
  ): Promise<VoiceInterface> {
    return new VoiceInterface(
      new VoiceRequestValidator(),
      sttProvider,
      ttsProvider,
      conversationGateway,
      new AuditLogger(config.auditLogPath),
    );
  }

  async handleVoiceMessage(request: VoiceRequest): Promise<VoiceResponse> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "voice-interface",
        eventType: "voice_validation_failed",
        details: { sessionId: request.sessionId, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "voice-interface",
      eventType: "voice_message_received",
      details: { sessionId: request.sessionId, mimeType: request.audio.mimeType },
    });

    const transcription = await this.sttProvider.transcribe(request.audio);
    if (transcription === null) {
      const limitations = [
        `No speech-to-text provider is configured (using "${this.sttProvider.name}"); the audio could not be transcribed.`,
      ];
      await this.auditLogger.logEvent({
        actor: "voice-interface",
        eventType: "voice_transcription_unavailable",
        details: { sessionId: request.sessionId, provider: this.sttProvider.name },
      });
      return {
        sessionId: request.sessionId,
        dataAvailable: false,
        transcript: null,
        replyText: null,
        replyAudio: null,
        routingDecision: null,
        limitations,
        decidedAt: new Date().toISOString(),
      };
    }

    const conversationResponse = await this.conversationGateway.handleMessage({
      sessionId: request.sessionId,
      message: transcription.text,
      ...(request.languageOverride !== undefined && { languageOverride: request.languageOverride }),
      ...(request.priority !== undefined && { priority: request.priority }),
    });

    const replyAudio = await this.ttsProvider.synthesize({
      text: conversationResponse.reply,
      language: conversationResponse.language,
    });

    const limitations: string[] = [];
    if (replyAudio === null) {
      limitations.push(
        `No text-to-speech provider is configured (using "${this.ttsProvider.name}"); the reply is available as text only.`,
      );
    }

    await this.auditLogger.logEvent({
      actor: "voice-interface",
      eventType: "voice_message_handled",
      details: {
        sessionId: request.sessionId,
        transcriptionSource: transcription.source,
        replyAudioAvailable: replyAudio !== null,
      },
    });

    return {
      sessionId: request.sessionId,
      dataAvailable: true,
      transcript: transcription.text,
      replyText: conversationResponse.reply,
      replyAudio,
      routingDecision: conversationResponse.routingDecision,
      limitations,
      decidedAt: new Date().toISOString(),
    };
  }
}
