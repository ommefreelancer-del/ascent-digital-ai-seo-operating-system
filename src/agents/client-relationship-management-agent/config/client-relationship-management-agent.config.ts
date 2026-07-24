// Configuration for the Client Relationship Management Agent, following the
// same defaults-plus-env-override-plus-explicit-override pattern as the
// other agents. No secrets are required: this agent makes no external
// calls -- it only aggregates real, already-computed upstream results and
// real, caller-supplied financial records.

import { join } from "node:path";

export interface ClientRelationshipManagementAgentConfig {
  readonly auditLogPath: string;
}

export type ClientRelationshipManagementAgentConfigOverrides = Partial<ClientRelationshipManagementAgentConfig>;

export function loadClientRelationshipManagementAgentConfig(
  overrides: ClientRelationshipManagementAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ClientRelationshipManagementAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CLIENT_RELATIONSHIP_MANAGEMENT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "client-relationship-management-agent", "audit-log.jsonl"),
  };
}
