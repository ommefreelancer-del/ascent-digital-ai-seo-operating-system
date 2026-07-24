// Builds real client profiles -- per the spec's "Maintain client profiles"
// responsibility. A direct passthrough of the AI CRM Agent's own real
// client status report; this agent never re-derives or invents a client's
// status or activity.

import type { ClientStatusEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";

export class ClientProfileBuilder {
  build(clientStatusReport: readonly ClientStatusEntry[]): ClientStatusEntry[] {
    return [...clientStatusReport];
  }
}
