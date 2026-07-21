import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStateStore, type TaskRunRecord } from "../../../src/boss-agent/state/task-state-store.js";

describe("TaskStateStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-task-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves a run and loads it back by runId", async () => {
    const store = new TaskStateStore(dir);
    const run: TaskRunRecord = {
      runId: "run-1",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcomes: [
        {
          task: { id: "task-1", description: "Improve rankings", priority: "high" },
          decision: {
            taskId: "task-1",
            status: "assigned",
            assignedAgentId: "agent-a",
            candidates: [],
            rationale: "Matched.",
            decidedAt: new Date().toISOString(),
          },
        },
      ],
    };

    await store.saveRun(run);
    const loaded = await store.loadRun("run-1");

    expect(loaded).toEqual(run);
  });

  it("returns undefined for a run that was never saved", async () => {
    const store = new TaskStateStore(dir);
    const loaded = await store.loadRun("does-not-exist");
    expect(loaded).toBeUndefined();
  });

  it("keeps separate runs in separate files", async () => {
    const store = new TaskStateStore(dir);
    const baseRun = {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcomes: [],
    };

    await store.saveRun({ ...baseRun, runId: "run-a" });
    await store.saveRun({ ...baseRun, runId: "run-b" });

    expect((await store.loadRun("run-a"))?.runId).toBe("run-a");
    expect((await store.loadRun("run-b"))?.runId).toBe("run-b");
  });
});
