// Builds one real ContactRecord per approved publisher -- per the spec's
// "Find public contact details", "Verify available information", and
// "Prepare contact records" responsibilities. Every field traces to a real
// candidate the ContactDiscoveryProvider reported; this builder never
// guesses a missing contact method or value. Verification status is the
// provider's own real determination -- when no verified candidate exists,
// the best available (still real) candidate is surfaced for transparency,
// but explicitly marked as not verified, per this agent's rule "forward
// verified records only".

import type { QualifiedProspect } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactDiscoveryProvider } from "../types/contact-discovery-provider.types.js";
import type { ContactRecord } from "../types/contact-intelligence-request.types.js";
import { pickPreferredContact } from "./contact-method-preference.js";

export interface ContactRecordBuildResult {
  readonly record: ContactRecord;
  readonly isVerified: boolean;
  /** True when the provider returned a real snapshot for this domain, regardless of whether a contact was found. */
  readonly snapshotObtained: boolean;
}

export class ContactRecordBuilder {
  async build(provider: ContactDiscoveryProvider, publisher: QualifiedProspect): Promise<ContactRecordBuildResult> {
    const snapshot = await provider.discoverContacts({ domain: publisher.domain, url: publisher.url });

    if (!snapshot || snapshot.candidates.length === 0) {
      return {
        record: {
          url: publisher.url,
          domain: publisher.domain,
          title: publisher.title,
          contactMethod: null,
          contactValue: null,
          sourceUrl: null,
          verificationNotes: "No public contact information could be discovered for this domain.",
        },
        isVerified: false,
        snapshotObtained: snapshot !== null,
      };
    }

    const verifiedCandidates = snapshot.candidates.filter((candidate) => candidate.isVerified);
    const pool = verifiedCandidates.length > 0 ? verifiedCandidates : snapshot.candidates;
    const best = pickPreferredContact(pool);

    const record: ContactRecord = {
      url: publisher.url,
      domain: publisher.domain,
      title: publisher.title,
      contactMethod: best.method,
      contactValue: best.value,
      sourceUrl: best.sourceUrl,
      verificationNotes: best.isVerified
        ? `Verified ${best.method} contact found at ${best.sourceUrl}.`
        : `A ${best.method} contact was found at ${best.sourceUrl} but could not be independently verified; ` +
          "per this agent's rule, this record is not forwarded as verified.",
    };

    return { record, isVerified: best.isVerified, snapshotObtained: true };
  }
}
