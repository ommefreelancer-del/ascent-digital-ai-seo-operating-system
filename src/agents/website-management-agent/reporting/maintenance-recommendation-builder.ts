// Builds prioritized maintenance recommendations from real, already-computed
// inputs only: the WebsiteManagementProvider's real health snapshot, the
// already-built backup/security reports, real "https" recommendations
// relayed from the Technical SEO Agent (SSL/TLS is this agent's own
// operational domain -- Cloudflare is literally one of its tools, so this
// is genuine cross-agent reuse, not duplicated logic), and the caller's own
// real update-request/security-alert text. Every recommendation that would
// touch the live site or an external system is marked `requiresApproval:
// true`, per GLOBAL_RULES.md's governance model -- this agent only ever
// prepares recommendations, never executes them.

import type { WebsiteHealthSnapshot } from "../types/website-management-provider.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { BackupReport, MaintenanceRecommendation, SecurityStatusReport } from "../types/website-management-request.types.js";

const RELAYED_TECHNICAL_SEO_CATEGORIES = new Set(["https"]);

export class MaintenanceRecommendationBuilder {
  build(
    snapshot: WebsiteHealthSnapshot | null,
    backupReport: BackupReport,
    securityStatusReport: SecurityStatusReport,
    technicalSeo: TechnicalSeoResult,
    updateRequests: readonly string[],
    securityAlerts: readonly string[],
  ): MaintenanceRecommendation[] {
    const recommendations: MaintenanceRecommendation[] = [];

    if (snapshot) {
      for (const update of snapshot.availableUpdates) {
        recommendations.push({
          category: "update",
          priority: update.isSecurityUpdate ? "high" : "medium",
          recommendation: `Update ${update.component} from ${update.currentVersion} to ${update.availableVersion}.`,
          rationale: update.isSecurityUpdate
            ? "Real, provider-reported security update."
            : "Real, provider-reported update available.",
          requiresApproval: true,
        });
      }
      if (snapshot.uptime && !snapshot.uptime.isUp) {
        recommendations.push({
          category: "uptime",
          priority: "high",
          recommendation: "Investigate the reported downtime immediately.",
          rationale: `Real, measured uptime check reports the site as down (last checked ${snapshot.uptime.lastCheckedAt}).`,
          requiresApproval: false,
        });
      }
    }

    if (backupReport.isCurrent !== true) {
      recommendations.push({
        category: "backup",
        priority: "high",
        recommendation: "Create a fresh, verified backup.",
        rationale: backupReport.recommendation,
        requiresApproval: true,
      });
    }

    if (securityStatusReport.status === "threats-detected") {
      recommendations.push({
        category: "security",
        priority: "high",
        recommendation:
          `Investigate and remediate the ${securityStatusReport.threatsFound} real threat(s) flagged by the ` +
          "security scan.",
        rationale: `Real security scan (last scanned ${securityStatusReport.lastScannedAt}) reports active threats.`,
        requiresApproval: true,
      });
    }

    for (const recommendation of technicalSeo.recommendations) {
      if (RELAYED_TECHNICAL_SEO_CATEGORIES.has(recommendation.category)) {
        recommendations.push({
          category: "security",
          priority: recommendation.priority,
          recommendation: `Coordinate with the Technical SEO Agent's recommendation: ${recommendation.recommendation}`,
          rationale: `Relayed from the Technical SEO Agent's real, already-computed recommendation: ${recommendation.rationale}`,
          requiresApproval: true,
        });
      }
    }

    for (const updateRequest of updateRequests) {
      recommendations.push({
        category: "content-update",
        priority: "medium",
        recommendation: `Apply the requested update: "${updateRequest}".`,
        rationale: "Caller-supplied website update request.",
        requiresApproval: true,
      });
    }

    for (const alert of securityAlerts) {
      recommendations.push({
        category: "security",
        priority: "high",
        recommendation: `Investigate and remediate the reported security alert: "${alert}".`,
        rationale: "Caller-supplied security alert.",
        requiresApproval: true,
      });
    }

    return recommendations;
  }
}
