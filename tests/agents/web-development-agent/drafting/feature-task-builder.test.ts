import { describe, expect, it } from "vitest";
import { FeatureTaskBuilder } from "../../../../src/agents/web-development-agent/drafting/feature-task-builder.js";

describe("FeatureTaskBuilder", () => {
  const builder = new FeatureTaskBuilder();

  it("returns no tasks for an empty list of design assets", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("builds one medium-priority task per real, caller-supplied design asset", () => {
    const [task] = builder.build(["Homepage hero redesign, see Figma link X"]);
    expect(task).toMatchObject({ category: "feature", priority: "medium" });
    expect(task?.description).toBe("Homepage hero redesign, see Figma link X");
  });

  it("includes standing responsiveness and accessibility acceptance criteria", () => {
    const [task] = builder.build(["New pricing page"]);
    expect(task?.acceptanceCriteria.some((c) => c.toLowerCase().includes("responsive"))).toBe(true);
    expect(task?.acceptanceCriteria.some((c) => c.toLowerCase().includes("accessib"))).toBe(true);
  });

  it("builds one task per asset, in order", () => {
    const tasks = builder.build(["Asset A", "Asset B"]);
    expect(tasks.map((t) => t.description)).toEqual(["Asset A", "Asset B"]);
  });
});
