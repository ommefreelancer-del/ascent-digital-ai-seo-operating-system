// The default ProspectDiscoveryProvider: honestly reports that no real
// prospect discovery is available, rather than fabricating any. This is
// what ProspectingAgent.create() uses until a real provider (an approved
// search engine, SEO tool, or public business directory integration) is
// deliberately wired in and approved per GLOBAL_RULES.md SS9 ("connecting
// external services" requires human approval).

import type {
  ProspectDiscoveryProvider,
  ProspectDiscoveryRequest,
  ProspectDiscoverySnapshot,
} from "../types/prospect-discovery-provider.types.js";

export class NullProspectDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly name = "none-configured";

  async discoverProspects(_request: ProspectDiscoveryRequest): Promise<ProspectDiscoverySnapshot | null> {
    return null;
  }
}
