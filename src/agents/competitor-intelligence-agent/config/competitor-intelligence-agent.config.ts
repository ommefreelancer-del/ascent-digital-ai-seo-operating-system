// Configuration for the Competitor Intelligence Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets required: this agent makes no external calls -- it
// reuses the real WebsiteAuditAgent (injected by the caller) to analyze
// caller-supplied competitor snapshots.

import { join } from "node:path";

export interface CompetitorIntelligenceAgentConfig {
  readonly auditLogPath: string;
}

export type CompetitorIntelligenceAgentConfigOverrides = Partial<CompetitorIntelligenceAgentConfig>;

export function loadCompetitorIntelligenceAgentConfig(
  overrides: CompetitorIntelligenceAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): CompetitorIntelligenceAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["COMPETITOR_INTELLIGENCE_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "competitor-intelligence-agent", "audit-log.jsonl"),
  };
}
