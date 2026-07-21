// Shape of the work items the Boss Agent is asked to route. This build only
// decides which specialist agent a task belongs to; it never executes the
// task.

export type TaskPriority = "high" | "normal" | "low";

export interface TaskInput {
  readonly id: string;
  readonly description: string;
  readonly priority: TaskPriority;
}
