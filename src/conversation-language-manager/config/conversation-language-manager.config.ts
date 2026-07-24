// Configuration for the Conversation & Language Manager, following the same
// defaults-plus-env-override-plus-explicit-override pattern as every
// specialist agent. No secrets are required: this module makes no external
// calls itself -- it only validates, detects language, classifies intent,
// and forwards to the injected BossAgentGateway.

import { join } from "node:path";

export interface ConversationLanguageManagerConfig {
  readonly auditLogPath: string;
}

export type ConversationLanguageManagerConfigOverrides = Partial<ConversationLanguageManagerConfig>;

export function loadConversationLanguageManagerConfig(
  overrides: ConversationLanguageManagerConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ConversationLanguageManagerConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CONVERSATION_LANGUAGE_MANAGER_AUDIT_LOG"] ??
      join(baseDirectory, "var", "conversation-language-manager", "audit-log.jsonl"),
  };
}
