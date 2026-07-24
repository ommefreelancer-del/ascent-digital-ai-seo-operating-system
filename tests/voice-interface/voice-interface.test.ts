import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoiceInterface } from "../../src/voice-interface/voice-interface.js";
import { VoiceRequestValidator } from "../../src/voice-interface/validation/voice-request-validator.js";
import { NullSpeechToTextProvider } from "../../src/voice-interface/providers/null-speech-to-text-provider.js";
import { NullTextToSpeechProvider } from "../../src/voice-interface/providers/null-text-to-speech-provider.js";
import { AuditLogger } from "../../src/core/governance/audit-logger.js";
import type {
  AudioInput,
  AudioOutput,
  ConversationGateway,
  SpeechSynthesisRequest,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult,
  VoiceRequest,
} from "../../src/voice-interface/types/voice-interface.types.js";
import type { RoutingDecision } from "../../src/boss-agent/types/routing.types.js";

class FixedSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "fixed-test-stt";
  constructor(private readonly result: TranscriptionResult | null) {}
  async transcribe(_audio: AudioInput): Promise<TranscriptionResult | null> {
    return this.result;
  }
}

class FixedTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "fixed-test-tts";
  constructor(private readonly result: AudioOutput | null) {}
  async synthesize(_request: SpeechSynthesisRequest): Promise<AudioOutput | null> {
    return this.result;
  }
}

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: "keyword-research-agent",
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

class FakeConversationGateway implements ConversationGateway {
  public receivedMessages: string[] = [];
  constructor(private readonly decision: RoutingDecision = makeDecision()) {}
  async handleMessage(request: { sessionId: string; message: string }) {
    this.receivedMessages.push(request.message);
    return {
      sessionId: request.sessionId,
      language: "en" as const,
      intent: "task_request" as const,
      reply: `Reply to: ${request.message}`,
      routingDecision: this.decision,
      decidedAt: new Date().toISOString(),
    };
  }
}

function makeRequest(overrides: Partial<VoiceRequest> = {}): VoiceRequest {
  return { sessionId: "session-1", audio: { data: "base64-audio-data", mimeType: "audio/wav" }, ...overrides };
}

describe("VoiceInterface", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "voice-interface-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildInterface(stt: SpeechToTextProvider, tts: TextToSpeechProvider, gateway: ConversationGateway) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const voiceInterface = new VoiceInterface(new VoiceRequestValidator(), stt, tts, gateway, new AuditLogger(auditLogPath));
    return { voiceInterface, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports dataAvailable false and never calls the conversation gateway when no STT provider is configured", async () => {
    const gateway = new FakeConversationGateway();
    const { voiceInterface, auditLogPath } = buildInterface(new NullSpeechToTextProvider(), new NullTextToSpeechProvider(), gateway);

    const response = await voiceInterface.handleVoiceMessage(makeRequest());

    expect(response.dataAvailable).toBe(false);
    expect(response.transcript).toBeNull();
    expect(response.replyText).toBeNull();
    expect(gateway.receivedMessages).toHaveLength(0);
    expect(response.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["voice_message_received", "voice_transcription_unavailable"]);
  });

  it("transcribes real audio, forwards it to the conversation gateway, and returns the real reply as text when no TTS provider is configured", async () => {
    const stt = new FixedSpeechToTextProvider({ text: "Help me improve my SEO.", confidence: 0.95, source: "fixed-test-stt" });
    const decision = makeDecision();
    const gateway = new FakeConversationGateway(decision);
    const { voiceInterface, auditLogPath } = buildInterface(stt, new NullTextToSpeechProvider(), gateway);

    const response = await voiceInterface.handleVoiceMessage(makeRequest());

    expect(response.dataAvailable).toBe(true);
    expect(response.transcript).toBe("Help me improve my SEO.");
    expect(response.replyText).toBe("Reply to: Help me improve my SEO.");
    expect(response.replyAudio).toBeNull();
    expect(response.routingDecision).toEqual(decision);
    expect(gateway.receivedMessages).toEqual(["Help me improve my SEO."]);
    expect(response.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["voice_message_received", "voice_message_handled"]);
  });

  it("returns real synthesized audio when a real TTS provider is configured", async () => {
    const stt = new FixedSpeechToTextProvider({ text: "Help me improve my SEO.", confidence: 0.95, source: "fixed-test-stt" });
    const tts = new FixedTextToSpeechProvider({ data: "base64-reply-audio", mimeType: "audio/mp3", source: "fixed-test-tts" });
    const { voiceInterface } = buildInterface(stt, tts, new FakeConversationGateway());

    const response = await voiceInterface.handleVoiceMessage(makeRequest());

    expect(response.replyAudio).toEqual({ data: "base64-reply-audio", mimeType: "audio/mp3", source: "fixed-test-tts" });
    expect(response.limitations).toEqual([]);
  });

  it("throws and audit-logs validation failures without transcribing", async () => {
    const stt = new FixedSpeechToTextProvider({ text: "Help me improve my SEO.", confidence: 0.95, source: "fixed-test-stt" });
    const { voiceInterface, auditLogPath } = buildInterface(stt, new NullTextToSpeechProvider(), new FakeConversationGateway());

    await expect(
      voiceInterface.handleVoiceMessage(makeRequest({ audio: { data: "   ", mimeType: "audio/wav" } })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["voice_validation_failed"]);
  });
});
