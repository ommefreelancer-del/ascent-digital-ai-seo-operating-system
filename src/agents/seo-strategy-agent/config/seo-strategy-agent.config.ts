// Configuration for the SEO Strategy Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets required: this agent makes no external calls -- it
// only synthesizes already-computed upstream results.

import { join } from "node:path";

export interface SeoStrategyAgentConfig {
  readonly auditLogPath: string;
}

export type SeoStrategyAgentConfigOverrides = Partial<SeoStrategyAgentConfig>;

export function loadSeoStrategyAgentConfig(
  overrides: SeoStrategyAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): SeoStrategyAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["SEO_STRATEGY_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "seo-strategy-agent", "audit-log.jsonl"),
  };
}
