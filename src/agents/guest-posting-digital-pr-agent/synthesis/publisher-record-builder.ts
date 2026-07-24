// Consolidates a real, domain-keyed publisher view -- per the spec's
// "Maintain a consolidated publisher database view" responsibility. Every
// field traces to a real, already-computed upstream result (Prospecting,
// Publisher Qualification, Outreach, Reply & Negotiation); this agent never
// re-derives a qualification, outreach status, or negotiation status --
// each is looked up, never guessed, and is `null` when no real evidence
// exists for that domain.

import type { Prospect } from "../../prospecting-agent/types/prospecting-request.types.js";
import type { QualifiedProspect } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachStatusEntry } from "../../outreach-agent/types/outreach-request.types.js";
import type { NegotiationStatusEntry } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { PublisherRecord } from "../types/guest-posting-digital-pr-request.types.js";

export class PublisherRecordBuilder {
  build(
    prospects: readonly Prospect[],
    approvedProspects: readonly QualifiedProspect[],
    rejectedProspects: readonly QualifiedProspect[],
    outreachStatus: readonly OutreachStatusEntry[],
    negotiationStatusReport: readonly NegotiationStatusEntry[],
  ): PublisherRecord[] {
    const qualificationByDomain = new Map<string, QualifiedProspect["decision"]>();
    for (const prospect of [...approvedProspects, ...rejectedProspects]) {
      qualificationByDomain.set(prospect.domain, prospect.decision);
    }

    const outreachByDomain = new Map(outreachStatus.map((entry) => [entry.domain, entry.status]));
    const negotiationByDomain = new Map(negotiationStatusReport.map((entry) => [entry.domain, entry.status]));

    return prospects.map((prospect) => ({
      domain: prospect.domain,
      title: prospect.title,
      category: prospect.category,
      qualification: qualificationByDomain.get(prospect.domain) ?? null,
      outreachStatus: outreachByDomain.get(prospect.domain) ?? null,
      negotiationStatus: negotiationByDomain.get(prospect.domain) ?? null,
      notes: prospect.notes,
    }));
  }
}
