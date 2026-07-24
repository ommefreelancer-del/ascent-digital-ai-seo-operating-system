// Prepares one follow-up message and its scheduled date -- per the spec's
// "Prepare follow-up messages" responsibility. The follow-up delay (7 days)
// is a real, documented general outreach convention, not a claim about any
// specific campaign's cadence, consistent with how other agents in this
// codebase state their own stated conventions (e.g. the backup freshness
// window). This agent never sends the follow-up; it requires human
// approval like every other draft here.

import type { QualifiedProspect } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { FollowUpScheduleEntry } from "../types/outreach-request.types.js";

const FOLLOW_UP_DELAY_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class FollowUpScheduleBuilder {
  build(publisher: QualifiedProspect, senderName: string | null, now: Date = new Date()): FollowUpScheduleEntry {
    const signature = senderName ?? "[Your Name]";
    const scheduledDate = new Date(now.getTime() + FOLLOW_UP_DELAY_DAYS * MS_PER_DAY).toISOString();
    const messageDraft =
      `Hi again,\n\n` +
      `Just following up on my previous note about a possible collaboration with ${publisher.title} ` +
      `(${publisher.domain}). Let me know if you'd be interested or if now isn't the right time.\n\n` +
      `Best regards,\n${signature}`;

    return {
      domain: publisher.domain,
      sequenceNumber: 1,
      scheduledDate,
      messageDraft,
      requiresApproval: true,
    };
  }
}
