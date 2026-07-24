// Configuration for the SEO Content Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullContentGenerationProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface SeoContentAgentConfig {
  readonly auditLogPath: string;
}

export type SeoContentAgentConfigOverrides = Partial<SeoContentAgentConfig>;

export function loadSeoContentAgentConfig(
  overrides: SeoContentAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): SeoContentAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["SEO_CONTENT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "seo-content-agent", "audit-log.jsonl"),
  };
}
