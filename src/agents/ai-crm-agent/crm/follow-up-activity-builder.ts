// Builds real follow-up activity records -- per the spec's "Track
// follow-up activities" responsibility. Every entry relays the Outreach
// Agent's own real, already-scheduled follow-up; this builder never
// invents a follow-up date or content.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { FollowUpActivity } from "../types/ai-crm-request.types.js";

export class FollowUpActivityBuilder {
  build(outreach: OutreachResult): FollowUpActivity[] {
    return outreach.followUpSchedule.map((entry) => ({
      domain: entry.domain,
      scheduledDate: entry.scheduledDate,
      description: `Follow-up #${entry.sequenceNumber} scheduled.`,
    }));
  }
}
