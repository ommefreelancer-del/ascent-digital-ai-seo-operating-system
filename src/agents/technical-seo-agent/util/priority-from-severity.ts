import type { AuditSeverity } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoPriority } from "../types/technical-seo-request.types.js";

/** Maps a real audit finding's severity to a recommendation priority, 1:1. */
export function priorityFromSeverity(severity: AuditSeverity): TechnicalSeoPriority {
  switch (severity) {
    case "critical":
      return "high";
    case "warning":
      return "medium";
    case "info":
    default:
      return "low";
  }
}
