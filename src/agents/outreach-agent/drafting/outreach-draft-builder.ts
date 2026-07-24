// Drafts one personalized outreach email -- per the spec's "Draft
// personalized outreach emails" responsibility. Personalization comes from
// substituting real data only: the real publisher title/domain (from the
// Publisher Qualification Agent) and the real, caller-supplied campaign
// requirements text. A bracketed placeholder stands in for the sender's
// name when none was supplied -- never a fabricated signature. This agent
// never sends the draft; every draft requires human approval per
// GLOBAL_RULES.md SS9.

import type { QualifiedProspect } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactMethod } from "../../contact-intelligence-agent/types/contact-discovery-provider.types.js";
import type { OutreachDraft } from "../types/outreach-request.types.js";

export class OutreachDraftBuilder {
  build(
    publisher: QualifiedProspect,
    contactMethod: ContactMethod,
    contactValue: string,
    campaignRequirements: string,
    senderName: string | null,
  ): OutreachDraft {
    const signature = senderName ?? "[Your Name]";
    const subject = `Partnership opportunity: ${publisher.title}`;
    const body =
      `Hi there,\n\n` +
      `I came across ${publisher.title} (${publisher.domain}) and think it could be a great fit for a ` +
      `collaboration related to: "${campaignRequirements}".\n\n` +
      `Would you be open to a guest post or link collaboration? Happy to share more details.\n\n` +
      `Best regards,\n${signature}`;

    return {
      domain: publisher.domain,
      url: publisher.url,
      title: publisher.title,
      contactMethod,
      contactValue,
      subject,
      body,
      requiresApproval: true,
    };
  }
}
