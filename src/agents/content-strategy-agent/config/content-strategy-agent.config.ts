// Configuration for the Content Strategy Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as
// src/agents/keyword-research-agent/config/keyword-research-agent.config.ts.
// No secrets required: this agent makes no external calls.

import { join } from "node:path";

export interface ContentStrategyAgentConfig {
  readonly auditLogPath: string;
}

export type ContentStrategyAgentConfigOverrides = Partial<ContentStrategyAgentConfig>;

export function loadContentStrategyAgentConfig(
  overrides: ContentStrategyAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ContentStrategyAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CONTENT_STRATEGY_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "content-strategy-agent", "audit-log.jsonl"),
  };
}
