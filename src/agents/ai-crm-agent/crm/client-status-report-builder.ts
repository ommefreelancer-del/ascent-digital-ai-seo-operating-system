// Builds a real client status report -- per the spec's "Identify inactive
// clients and prospects" responsibility. Activity is a real date
// comparison against a documented general convention (no contact in over
// 90 days is considered inactive), not a claim about any specific client
// relationship's actual cadence, consistent with how other agents in this
// codebase state their own thresholds (e.g. the backup freshness window).

import type { ClientActivityStatus, ClientInfoEntry, ClientStatusEntry } from "../types/ai-crm-request.types.js";

const INACTIVITY_THRESHOLD_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function activityFor(lastContactedAt: string, now: Date): ClientActivityStatus {
  const daysSinceContact = (now.getTime() - new Date(lastContactedAt).getTime()) / MS_PER_DAY;
  return daysSinceContact > INACTIVITY_THRESHOLD_DAYS ? "inactive" : "active";
}

export class ClientStatusReportBuilder {
  build(clientInfo: readonly ClientInfoEntry[], now: Date = new Date()): ClientStatusEntry[] {
    return clientInfo.map((client) => ({
      clientName: client.clientName,
      status: client.status,
      activity: activityFor(client.lastContactedAt, now),
      lastContactedAt: client.lastContactedAt,
    }));
  }
}
