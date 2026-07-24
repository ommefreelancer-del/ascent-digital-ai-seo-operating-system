// Configuration for the AI CRM Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only aggregates already-computed upstream results and caller-supplied
// client information.

import { join } from "node:path";

export interface AiCrmAgentConfig {
  readonly auditLogPath: string;
}

export type AiCrmAgentConfigOverrides = Partial<AiCrmAgentConfig>;

export function loadAiCrmAgentConfig(
  overrides: AiCrmAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): AiCrmAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["AI_CRM_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "ai-crm-agent", "audit-log.jsonl"),
  };
}
