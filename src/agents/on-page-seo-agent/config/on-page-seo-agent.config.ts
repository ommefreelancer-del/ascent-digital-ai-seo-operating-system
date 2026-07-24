// Configuration for the On-Page SEO Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets required: this agent makes no external calls.

import { join } from "node:path";

export interface OnPageSeoAgentConfig {
  readonly auditLogPath: string;
}

export type OnPageSeoAgentConfigOverrides = Partial<OnPageSeoAgentConfig>;

export function loadOnPageSeoAgentConfig(
  overrides: OnPageSeoAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): OnPageSeoAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["ON_PAGE_SEO_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "on-page-seo-agent", "audit-log.jsonl"),
  };
}
