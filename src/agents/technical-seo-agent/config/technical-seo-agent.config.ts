// Configuration for the Technical SEO Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets required: this agent makes no external calls.

import { join } from "node:path";

export interface TechnicalSeoAgentConfig {
  readonly auditLogPath: string;
}

export type TechnicalSeoAgentConfigOverrides = Partial<TechnicalSeoAgentConfig>;

export function loadTechnicalSeoAgentConfig(
  overrides: TechnicalSeoAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): TechnicalSeoAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["TECHNICAL_SEO_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "technical-seo-agent", "audit-log.jsonl"),
  };
}
