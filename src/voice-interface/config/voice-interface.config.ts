// Configuration for the Voice Interface, following the same
// defaults-plus-env-override-plus-explicit-override pattern as every other
// module. No secrets are required here: real speech-provider credentials,
// if ever wired in, belong to a concrete SpeechToTextProvider/
// TextToSpeechProvider implementation, not this config.

import { join } from "node:path";

export interface VoiceInterfaceConfig {
  readonly auditLogPath: string;
}

export type VoiceInterfaceConfigOverrides = Partial<VoiceInterfaceConfig>;

export function loadVoiceInterfaceConfig(
  overrides: VoiceInterfaceConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): VoiceInterfaceConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["VOICE_INTERFACE_AUDIT_LOG"] ??
      join(baseDirectory, "var", "voice-interface", "audit-log.jsonl"),
  };
}
