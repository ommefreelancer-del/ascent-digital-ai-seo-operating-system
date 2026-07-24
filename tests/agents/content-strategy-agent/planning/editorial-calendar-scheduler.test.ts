import { describe, expect, it } from "vitest";
import { EditorialCalendarScheduler } from "../../../../src/agents/content-strategy-agent/planning/editorial-calendar-scheduler.js";
import type { PillarPageStrategyEntry } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeEntry(overrides: Partial<PillarPageStrategyEntry> = {}): PillarPageStrategyEntry {
  return {
    clusterLabel: "plumber",
    pillarKeyword: "plumber",
    pillarTitle: "Pillar: Plumber",
    pillarIntent: "informational",
    supportingArticles: [
      { keyword: "emergency plumber", intent: "informational", suggestedTitle: "Supporting: Emergency Plumber" },
      { keyword: "licensed plumber", intent: "informational", suggestedTitle: "Supporting: Licensed Plumber" },
    ],
    priorityRank: 1,
    ...overrides,
  };
}

describe("EditorialCalendarScheduler", () => {
  const scheduler = new EditorialCalendarScheduler();
  const START_DATE = "2026-01-01T00:00:00.000Z";

  it("schedules the pillar before its supporting articles", () => {
    const entries = scheduler.build([makeEntry()], START_DATE, 7);

    expect(entries[0]?.contentType).toBe("pillar");
    expect(entries[0]?.title).toBe("Pillar: Plumber");
    expect(entries[1]?.contentType).toBe("supporting");
    expect(entries[2]?.contentType).toBe("supporting");
  });

  it("spaces entries by 7/articlesPerWeek days, starting from the given date", () => {
    const entries = scheduler.build([makeEntry()], START_DATE, 7);

    expect(entries[0]?.scheduledDate).toBe("2026-01-01T00:00:00.000Z");
    expect(entries[1]?.scheduledDate).toBe("2026-01-02T00:00:00.000Z");
    expect(entries[2]?.scheduledDate).toBe("2026-01-03T00:00:00.000Z");
  });

  it("uses a 2-per-week default cadence when articlesPerWeek is omitted", () => {
    // 7/2 = 3.5 days between entries, rounded to the nearest whole day since
    // content is scheduled per-day, not per-half-day.
    const entries = scheduler.build([makeEntry()], START_DATE);

    expect(entries[0]?.scheduledDate).toBe("2026-01-01T00:00:00.000Z");
    expect(entries[1]?.scheduledDate).toBe("2026-01-05T00:00:00.000Z");
  });

  it("continues the schedule across multiple pillar entries in order", () => {
    const entries = scheduler.build(
      [
        makeEntry({ clusterLabel: "first", supportingArticles: [] }),
        makeEntry({ clusterLabel: "second", pillarTitle: "Pillar: Second", supportingArticles: [] }),
      ],
      START_DATE,
      7,
    );

    expect(entries.map((e) => e.title)).toEqual(["Pillar: Plumber", "Pillar: Second"]);
    expect(entries[1]?.scheduledDate).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns an empty array when there is no pillar strategy", () => {
    expect(scheduler.build([], START_DATE, 7)).toEqual([]);
  });
});
