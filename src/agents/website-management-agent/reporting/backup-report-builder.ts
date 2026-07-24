// Builds a BackupReport from a real BackupStatus. "Current" is a real date
// comparison against a documented, general best-practice cadence (backups
// no older than 7 days) -- a stated convention, not a claim about any
// specific hosting SLA, consistent with how other agents in this codebase
// state their own conventions (e.g. Core Web Vitals thresholds,
// StrategyItemCollector's effort categories) rather than inventing
// business-specific numbers.

import type { BackupStatus } from "../types/website-management-provider.types.js";
import type { BackupReport } from "../types/website-management-request.types.js";

const BACKUP_FRESHNESS_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class BackupReportBuilder {
  build(backupStatus: BackupStatus | null, now: Date = new Date()): BackupReport {
    if (!backupStatus || !backupStatus.lastBackupAt) {
      return {
        lastBackupAt: null,
        isCurrent: null,
        recommendation: "No real backup data is available; create a fresh backup before any major change.",
      };
    }

    const ageInDays = (now.getTime() - new Date(backupStatus.lastBackupAt).getTime()) / MS_PER_DAY;
    const isCurrent = ageInDays <= BACKUP_FRESHNESS_THRESHOLD_DAYS && backupStatus.isRestorable !== false;

    return {
      lastBackupAt: backupStatus.lastBackupAt,
      isCurrent,
      recommendation: isCurrent
        ? "The most recent backup is within the recommended freshness window and reports as restorable."
        : `The most recent backup is older than ${BACKUP_FRESHNESS_THRESHOLD_DAYS} days or not confirmed ` +
          "restorable; create a fresh, verified backup before any major change.",
    };
  }
}
