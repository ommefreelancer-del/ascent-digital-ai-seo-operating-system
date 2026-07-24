// Builds a real CRM synchronization report -- per the spec's "Synchronize
// data with the AI CRM Agent" responsibility. A direct echo of the AI CRM
// Agent's own real, already-proposed record updates; never invents a sync
// event of its own.

import type { CrmRecordUpdate } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { CrmSyncReportEntry } from "../types/google-sheets-integration-request.types.js";

export class CrmSyncReportBuilder {
  build(crmRecordUpdates: readonly CrmRecordUpdate[]): CrmSyncReportEntry[] {
    return crmRecordUpdates.map((update) => ({
      identifier: update.identifier,
      summary: `${update.action} ${update.recordType}: ${update.summary}`,
    }));
  }
}
