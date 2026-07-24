// Configuration for the Business Development Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only aggregates already-computed CRM data and real, caller-supplied
// business context.

import { join } from "node:path";

export interface BusinessDevelopmentAgentConfig {
  readonly auditLogPath: string;
}

export type BusinessDevelopmentAgentConfigOverrides = Partial<BusinessDevelopmentAgentConfig>;

export function loadBusinessDevelopmentAgentConfig(
  overrides: BusinessDevelopmentAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): BusinessDevelopmentAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["BUSINESS_DEVELOPMENT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "business-development-agent", "audit-log.jsonl"),
  };
}
