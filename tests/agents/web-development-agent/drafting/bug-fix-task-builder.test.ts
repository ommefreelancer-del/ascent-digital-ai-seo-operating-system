import { describe, expect, it } from "vitest";
import { BugFixTaskBuilder } from "../../../../src/agents/web-development-agent/drafting/bug-fix-task-builder.js";

describe("BugFixTaskBuilder", () => {
  const builder = new BugFixTaskBuilder();

  it("returns no tasks for an empty list of bug reports", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("builds one high-priority task per real, caller-supplied bug report", () => {
    const [task] = builder.build(["The contact form submit button does not work on mobile."]);
    expect(task).toMatchObject({ category: "bug-fix", priority: "high" });
    expect(task?.description).toBe("The contact form submit button does not work on mobile.");
    expect(task?.title).toContain("The contact form submit button does not work on mobile.");
  });

  it("never invents a root cause -- rationale states the report is caller-supplied", () => {
    const [task] = builder.build(["Something is broken."]);
    expect(task?.rationale).toBe("Caller-supplied bug report.");
  });

  it("builds one task per report, in order", () => {
    const tasks = builder.build(["Bug A", "Bug B"]);
    expect(tasks.map((t) => t.description)).toEqual(["Bug A", "Bug B"]);
  });
});
