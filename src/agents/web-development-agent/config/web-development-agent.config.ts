// Configuration for the Web Development Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullCodeGenerationProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface WebDevelopmentAgentConfig {
  readonly auditLogPath: string;
}

export type WebDevelopmentAgentConfigOverrides = Partial<WebDevelopmentAgentConfig>;

export function loadWebDevelopmentAgentConfig(
  overrides: WebDevelopmentAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): WebDevelopmentAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["WEB_DEVELOPMENT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "web-development-agent", "audit-log.jsonl"),
  };
}
