// Shapes for the small, dependency-free workflow engine (workflow-engine.ts).
// A workflow is an ordered list of steps that share one mutable context bag
// (get/set by string key) -- deliberately not a typed pipeline, since the 23
// real steps in seo-audit-workflow.ts each read/write heterogeneous, already
// real result types (WebsiteCrawlResult, KeywordResearchResult, etc.) that
// come from agents that already exist and are not being changed for this.

/** Read/write access to the shared data every step in a run can see. */
export interface WorkflowContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
}

/**
 * What a step reports after running. `halt` is a normal, expected outcome
 * (e.g. a human declined an approval) -- it stops the run without being
 * treated as a bug. A thrown error is always treated as `failed` by the
 * engine and also halts the run; steps should throw only for genuine,
 * unexpected failures, and return `skipped` for known, honest gaps (e.g. no
 * competitor data was supplied).
 */
export type WorkflowStepOutcome =
  | { readonly outcome: "completed" }
  | { readonly outcome: "skipped"; readonly reason: string }
  | { readonly outcome: "halt"; readonly reason: string };

export interface WorkflowStep {
  readonly id: string;
  readonly name: string;
  run(context: WorkflowContext): Promise<WorkflowStepOutcome>;
}

export type WorkflowStepStatus = "completed" | "skipped" | "failed" | "halted" | "not_run";

export interface WorkflowStepResult {
  readonly stepId: string;
  readonly name: string;
  readonly status: WorkflowStepStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The skip/halt reason, or the thrown error's message, or `null` on a clean completion. */
  readonly detail: string | null;
}

export interface WorkflowRunResult {
  readonly runId: string;
  readonly workflowName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly halted: boolean;
  readonly haltReason: string | null;
  readonly stepResults: readonly WorkflowStepResult[];
  /** A plain-object snapshot of the shared context after the run, for callers that just need the data. */
  readonly outputs: Readonly<Record<string, unknown>>;
}
