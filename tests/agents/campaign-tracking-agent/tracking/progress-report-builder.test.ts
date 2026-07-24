import { describe, expect, it } from "vitest";
import { ProgressReportBuilder } from "../../../../src/agents/campaign-tracking-agent/tracking/progress-report-builder.js";

describe("ProgressReportBuilder", () => {
  const builder = new ProgressReportBuilder();

  it("returns no entries for an empty list", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("sorts real updates by date, ascending", () => {
    const entries = builder.build([
      { date: "2026-07-10", description: "Second update" },
      { date: "2026-07-01", description: "First update" },
    ]);
    expect(entries.map((e) => e.description)).toEqual(["First update", "Second update"]);
  });

  it("passes through the real description text verbatim", () => {
    const [entry] = builder.build([{ date: "2026-07-01", description: "Publisher X confirmed a guest post slot." }]);
    expect(entry?.description).toBe("Publisher X confirmed a guest post slot.");
  });
});
