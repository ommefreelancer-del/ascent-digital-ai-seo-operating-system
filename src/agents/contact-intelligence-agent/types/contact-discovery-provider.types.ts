// The seam between "the agent needs real, public contact information" and
// "where that information actually comes from". This agent's own rules
// require it to "use only publicly available information" and "do not
// guess missing information" -- GLOBAL_RULES.md SS9 requires explicit
// human approval before "connecting external services". No concrete
// provider ships in this build -- only the interface and a
// NullContactDiscoveryProvider that honestly reports "unavailable" (see
// providers/null-contact-discovery-provider.ts). Per this agent's own rule
// "forward verified records only", a contact candidate the provider itself
// did not mark verified is never presented as a verified record -- see
// contact/contact-record-builder.ts.

export interface ContactDiscoveryRequest {
  readonly domain: string;
  readonly url: string;
}

export type ContactMethod = "email" | "contact-form" | "social-media" | "phone";

/** One real, publicly discovered contact candidate, as reported by the provider. Never invented locally. */
export interface RawContactCandidate {
  readonly method: ContactMethod;
  readonly value: string;
  /** The provider's own real verification determination -- never inferred locally. */
  readonly isVerified: boolean;
  /** The real public page this candidate was found on. */
  readonly sourceUrl: string;
}

export interface ContactDiscoverySnapshot {
  readonly domain: string;
  readonly candidates: readonly RawContactCandidate[];
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface ContactDiscoveryProvider {
  readonly name: string;
  /**
   * Resolves to the real contact discovery snapshot for the requested
   * domain, or `null` if no data is available (no provider configured,
   * discovery failed, etc). Implementations must never invent a candidate
   * here -- `null` is always the correct response when genuine discovery
   * cannot be performed. This agent uses only publicly available
   * information -- a provider must never send an email or message on the
   * agent's behalf.
   */
  discoverContacts(request: ContactDiscoveryRequest): Promise<ContactDiscoverySnapshot | null>;
}
