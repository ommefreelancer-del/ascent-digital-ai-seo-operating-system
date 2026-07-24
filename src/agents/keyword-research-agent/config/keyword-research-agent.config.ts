// Configuration for the Keyword Research Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as
// src/boss-agent/config/boss-agent.config.ts. No secrets are required: the
// default NullKeywordDataProvider makes no external calls, so there is
// nothing to authenticate against until a real provider is deliberately
// wired in.

import { join } from "node:path";

export interface KeywordResearchAgentConfig {
  /** File path for this agent's append-only audit log. */
  readonly auditLogPath: string;
}

export type KeywordResearchAgentConfigOverrides = Partial<KeywordResearchAgentConfig>;

export function loadKeywordResearchAgentConfig(
  overrides: KeywordResearchAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): KeywordResearchAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["KEYWORD_RESEARCH_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "keyword-research-agent", "audit-log.jsonl"),
  };
}
