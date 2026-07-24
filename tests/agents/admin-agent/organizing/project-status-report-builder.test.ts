import { describe, expect, it } from "vitest";
import { ProjectStatusReportBuilder } from "../../../../src/agents/admin-agent/organizing/project-status-report-builder.js";
import type { ProjectUpdateEntry } from "../../../../src/agents/admin-agent/types/admin-request.types.js";

describe("ProjectStatusReportBuilder", () => {
  const builder = new ProjectStatusReportBuilder();

  it("returns an empty report for no updates", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("passes through every real project update unchanged", () => {
    const updates: ProjectUpdateEntry[] = [
      { projectName: "Acme Website Revamp", status: "in-progress", note: "On track." },
      { projectName: "Beta Migration", status: "completed", note: "Wrapped up last week." },
    ];

    expect(builder.build(updates)).toEqual(updates);
  });
});
