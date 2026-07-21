// Persists the outcome of each Boss Agent run (the tasks it was given and
// the routing decision reached for each one) as one JSON file per run. One
// file per run avoids any concurrent-write coordination: runs never share a
// file, so there is nothing to lock.

import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../../core/persistence/json-file-store.js";
import type { RoutingDecision } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";

export interface TaskOutcome {
  readonly task: TaskInput;
  readonly decision: RoutingDecision;
}

export interface TaskRunRecord {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcomes: readonly TaskOutcome[];
}

export class TaskStateStore {
  constructor(private readonly stateDirectory: string) {}

  async saveRun(run: TaskRunRecord): Promise<string> {
    const filePath = this.runFilePath(run.runId);
    await writeJsonFileAtomic(filePath, run);
    return filePath;
  }

  async loadRun(runId: string): Promise<TaskRunRecord | undefined> {
    return readJsonFile<TaskRunRecord>(this.runFilePath(runId));
  }

  private runFilePath(runId: string): string {
    return join(this.stateDirectory, `${runId}.json`);
  }
}
