// The default GbpDataProvider: honestly reports that no real Google
// Business Profile data is available, rather than fabricating any. This is
// what GoogleBusinessProfileAgent.create() uses until a real provider
// (Google Business Profile API, BrightLocal, etc.) is deliberately wired in
// and approved per GLOBAL_RULES.md SS9 ("connecting external services"
// requires human approval).

import type { GbpDataProvider, GbpDataRequest, GbpSnapshot } from "../types/gbp-data-provider.types.js";

export class NullGbpDataProvider implements GbpDataProvider {
  readonly name = "none-configured";

  async fetchGbpSnapshot(_request: GbpDataRequest): Promise<GbpSnapshot | null> {
    return null;
  }
}
