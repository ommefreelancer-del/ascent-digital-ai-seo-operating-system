// Configuration for the Off-Page SEO Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullBacklinkDataProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface OffPageSeoAgentConfig {
  readonly auditLogPath: string;
}

export type OffPageSeoAgentConfigOverrides = Partial<OffPageSeoAgentConfig>;

export function loadOffPageSeoAgentConfig(
  overrides: OffPageSeoAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): OffPageSeoAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["OFF_PAGE_SEO_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "off-page-seo-agent", "audit-log.jsonl"),
  };
}
