// Schedules pillar pages and their supporting articles into an editorial
// calendar: pillar first, then its supporting articles, in priority order,
// spaced evenly at the requested cadence starting from a caller-supplied
// date. Both the start date and cadence are explicit inputs (validated
// upstream by ContentStrategyRequestValidator) -- nothing about the schedule
// is invented, only computed from what the caller provided.

import type { ContentType, EditorialCalendarEntry, PillarPageStrategyEntry } from "../types/content-strategy-request.types.js";

const DEFAULT_ARTICLES_PER_WEEK = 2;
const DAYS_PER_WEEK = 7;

export class EditorialCalendarScheduler {
  build(
    pillarStrategy: readonly PillarPageStrategyEntry[],
    startDate: string,
    articlesPerWeek: number = DEFAULT_ARTICLES_PER_WEEK,
  ): EditorialCalendarEntry[] {
    const start = new Date(startDate);
    const daysBetweenEntries = DAYS_PER_WEEK / articlesPerWeek;
    const entries: EditorialCalendarEntry[] = [];
    let dayOffset = 0;

    const schedule = (contentType: ContentType, title: string, targetKeyword: string, clusterLabel: string): void => {
      const scheduledDate = new Date(start.getTime());
      scheduledDate.setUTCDate(scheduledDate.getUTCDate() + Math.round(dayOffset));
      entries.push({
        scheduledDate: scheduledDate.toISOString(),
        contentType,
        title,
        targetKeyword,
        clusterLabel,
      });
      dayOffset += daysBetweenEntries;
    };

    for (const entry of pillarStrategy) {
      schedule("pillar", entry.pillarTitle, entry.pillarKeyword, entry.clusterLabel);
      for (const supporting of entry.supportingArticles) {
        schedule("supporting", supporting.suggestedTitle, supporting.keyword, entry.clusterLabel);
      }
    }

    return entries;
  }
}
