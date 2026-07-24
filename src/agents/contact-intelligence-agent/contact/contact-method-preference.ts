// A documented, stated preference order for "the best contact method" --
// per the spec's "Identify the best contact method" responsibility. Direct
// email is preferred (fastest, most personal), then a contact form
// (reliable but slower), then social media (public but less formal), then
// phone (least scalable for outreach). This is a general convention, not a
// claim about which method is objectively best for any specific publisher.

import type { ContactMethod, RawContactCandidate } from "../types/contact-discovery-provider.types.js";

export const CONTACT_METHOD_PREFERENCE_ORDER: readonly ContactMethod[] = [
  "email",
  "contact-form",
  "social-media",
  "phone",
];

/** Picks the most-preferred real candidate from a non-empty list, per the stated preference order. */
export function pickPreferredContact(candidates: readonly RawContactCandidate[]): RawContactCandidate {
  for (const method of CONTACT_METHOD_PREFERENCE_ORDER) {
    const match = candidates.find((candidate) => candidate.method === method);
    if (match) {
      return match;
    }
  }
  // TypeScript can't see that CONTACT_METHOD_PREFERENCE_ORDER covers every ContactMethod;
  // a non-empty candidates array always matches one of the loop's iterations above.
  return candidates[0] as RawContactCandidate;
}
