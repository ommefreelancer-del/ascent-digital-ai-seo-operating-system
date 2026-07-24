// Input/output shapes for the Website Management Agent, per
// Agents/website-management-agent.md. This agent never executes an update,
// backup, restore, or security action -- it only produces real, deterministic
// health/backup/security reports and prioritized maintenance recommendations,
// each explicitly marked with whether it would require a real, external,
// state-changing action (`requiresApproval: true`) per GLOBAL_RULES.md's
// governance model ("agents may prepare drafts and recommendations without
// approval but must not execute these actions unless explicitly authorized").
// With no WebsiteManagementProvider configured (the default), `dataAvailable`
// is false and every data-dependent field is empty/null/"unknown" -- this
// agent never invents an uptime percentage, update version, backup date, or
// security scan result.

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";

export interface WebsiteManagementRequest {
  readonly id: string;
  readonly url: string;
  readonly websiteAudit: WebsiteAuditResult;
  readonly technicalSeo: TechnicalSeoResult;
  /** Optional free-text business context. Echoed into limitations if omitted, never invented. */
  readonly businessRequirements?: string;
  /** Optional real, caller-supplied update requests (e.g. "Update the homepage banner text"). */
  readonly updateRequests?: readonly string[];
  /** Optional real, caller-supplied security alert text (e.g. relayed from Wordfence). */
  readonly securityAlerts?: readonly string[];
}

export type WebsiteHealthStatus = "unknown" | "healthy" | "needs-attention" | "critical";

export interface WebsiteHealthReport {
  readonly status: WebsiteHealthStatus;
  readonly isUp: boolean | null;
  readonly uptimePercentage: number | null;
  readonly availableUpdateCount: number;
  readonly securityUpdateCount: number;
}

export interface BackupReport {
  readonly lastBackupAt: string | null;
  /** True only when a real backup exists and is newer than the freshness threshold -- see backup-report-builder.ts. */
  readonly isCurrent: boolean | null;
  readonly recommendation: string;
}

export type SecurityStatus = "no-data" | "clean" | "threats-detected";

export interface SecurityStatusReport {
  readonly status: SecurityStatus;
  readonly threatsFound: number | null;
  readonly lastScannedAt: string | null;
}

export type MaintenanceCategory = "update" | "backup" | "security" | "uptime" | "content-update";
export type MaintenancePriority = "high" | "medium" | "low";

export interface MaintenanceRecommendation {
  readonly category: MaintenanceCategory;
  readonly priority: MaintenancePriority;
  readonly recommendation: string;
  readonly rationale: string;
  /** True when carrying this out would change the live site or an external system -- always requires human approval before execution. */
  readonly requiresApproval: boolean;
}

export interface WebsiteManagementResult {
  readonly requestId: string;
  readonly url: string;
  /** False when no WebsiteManagementProvider supplied real data -- data-dependent fields are then empty/null/"unknown", never guessed. */
  readonly dataAvailable: boolean;
  readonly healthReport: WebsiteHealthReport;
  readonly backupReport: BackupReport;
  readonly securityStatusReport: SecurityStatusReport;
  readonly maintenanceRecommendations: readonly MaintenanceRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
