// Configuration for the Performance & Analytics Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullPerformanceDataProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface PerformanceAnalyticsAgentConfig {
  readonly auditLogPath: string;
}

export type PerformanceAnalyticsAgentConfigOverrides = Partial<PerformanceAnalyticsAgentConfig>;

export function loadPerformanceAnalyticsAgentConfig(
  overrides: PerformanceAnalyticsAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): PerformanceAnalyticsAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["PERFORMANCE_ANALYTICS_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "performance-analytics-agent", "audit-log.jsonl"),
  };
}
