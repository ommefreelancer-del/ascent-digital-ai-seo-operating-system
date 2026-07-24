// Configuration for the Campaign Tracking Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only aggregates already-computed upstream results and caller-supplied
// updates.

import { join } from "node:path";

export interface CampaignTrackingAgentConfig {
  readonly auditLogPath: string;
}

export type CampaignTrackingAgentConfigOverrides = Partial<CampaignTrackingAgentConfig>;

export function loadCampaignTrackingAgentConfig(
  overrides: CampaignTrackingAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): CampaignTrackingAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CAMPAIGN_TRACKING_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "campaign-tracking-agent", "audit-log.jsonl"),
  };
}
