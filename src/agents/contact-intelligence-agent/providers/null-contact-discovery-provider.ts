// The default ContactDiscoveryProvider: honestly reports that no real
// contact information is available, rather than fabricating any. This is
// what ContactIntelligenceAgent.create() uses until a real provider (an
// approved public-website research tool) is deliberately wired in and
// approved per GLOBAL_RULES.md SS9 ("connecting external services"
// requires human approval).

import type {
  ContactDiscoveryProvider,
  ContactDiscoveryRequest,
  ContactDiscoverySnapshot,
} from "../types/contact-discovery-provider.types.js";

export class NullContactDiscoveryProvider implements ContactDiscoveryProvider {
  readonly name = "none-configured";

  async discoverContacts(_request: ContactDiscoveryRequest): Promise<ContactDiscoverySnapshot | null> {
    return null;
  }
}
