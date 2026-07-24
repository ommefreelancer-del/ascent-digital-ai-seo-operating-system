// Passes through real, caller-supplied campaign updates as progress report
// entries -- per the spec's "Update campaign records" and "Generate
// campaign summaries" responsibilities. Sorted by real date, ascending;
// never rewords or fabricates the caller's own description text.

import type { CampaignUpdateEntry, ProgressReportEntry } from "../types/campaign-tracking-request.types.js";

export class ProgressReportBuilder {
  build(campaignUpdates: readonly CampaignUpdateEntry[]): ProgressReportEntry[] {
    return [...campaignUpdates]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((update) => ({ date: update.date, description: update.description }));
  }
}
