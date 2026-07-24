// The default WebsiteManagementProvider: honestly reports that no real
// website health data is available, rather than fabricating any. This is
// what WebsiteManagementAgent.create() uses until a real provider
// (WordPress, cPanel/hosting dashboard, Cloudflare, UpdraftPlus, Wordfence,
// etc.) is deliberately wired in and approved per GLOBAL_RULES.md SS9
// ("connecting external services" requires human approval).

import type {
  WebsiteHealthRequest,
  WebsiteHealthSnapshot,
  WebsiteManagementProvider,
} from "../types/website-management-provider.types.js";

export class NullWebsiteManagementProvider implements WebsiteManagementProvider {
  readonly name = "none-configured";

  async fetchWebsiteHealth(_request: WebsiteHealthRequest): Promise<WebsiteHealthSnapshot | null> {
    return null;
  }
}
