// The default BacklinkDataProvider: honestly reports that no real backlink
// data is available, rather than fabricating any. This is what
// OffPageSeoAgent.create() uses until a real provider (Ahrefs, SEMrush,
// Majestic, Moz, etc.) is deliberately wired in and approved per
// GLOBAL_RULES.md SS9 ("connecting external services" requires human
// approval).

import type {
  BacklinkDataProvider,
  BacklinkMetricsRequest,
  BacklinkProfile,
} from "../types/backlink-data-provider.types.js";

export class NullBacklinkDataProvider implements BacklinkDataProvider {
  readonly name = "none-configured";

  async fetchBacklinkProfile(_request: BacklinkMetricsRequest): Promise<BacklinkProfile | null> {
    return null;
  }
}
