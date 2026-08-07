// A small, dependency-free sequential workflow runner. Runs each step in
// order against one shared context bag, logs every step via the same
// AuditLogger pattern every agent in this codebase already uses (GLOBAL_RULES.md
// SS10), and halts the run -- rather than plowing ahead -- on a step that
// reports `halt` (e.g. a human declined an approval) or throws (a genuine,
// unexpected failure). A step that reports `skipped` is a normal, honest gap
// (e.g. "no competitor data was supplied") and does not stop the run.
//
// This is what seo-audit-workflow.ts (Phase 3, 23 steps) and
// blog-generation-workflow.ts (Phase 4) are both built on. Neither this
// engine nor any step it runs ever calls an ApprovalChannel itself for
// "should this workflow keep going" -- individual steps that need human
// approval (e.g. the blog workflow's publish gate) call ApprovalChannel
// themselves and report `halt` if declined, reusing the exact same
// governance primitive every other agent in this codebase uses.

import { randomUUID } from "node:crypto";
import { AuditLogger } from "../governance/audit-logger.js";
import type { WorkflowContext, WorkflowRunResult, WorkflowStep, WorkflowStepResult } from "./workflow-step.types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function createContext(initial: Readonly<Record<string, unknown>>): { context: WorkflowContext; store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  const context: WorkflowContext = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    has: (key) => store.has(key),
  };
  return { context, store };
}

export class WorkflowEngine {
  constructor(private readonly auditLogger: AuditLogger) {}

  async run(
    workflowName: string,
    steps: readonly WorkflowStep[],
    initialContext: Readonly<Record<string, unknown>> = {},
  ): Promise<WorkflowRunResult> {
    const runId = randomUUID();
    const startedAt = nowIso();
    const { context, store } = createContext(initialContext);
    const stepResults: WorkflowStepResult[] = [];
    let halted = false;
    let haltReason: string | null = null;

    await this.auditLogger.logEvent({
      actor: "workflow-engine",
      eventType: "workflow_started",
      details: { runId, workflowName, stepCount: steps.length },
    });

    for (const step of steps) {
      if (halted) {
        stepResults.push({
          stepId: step.id,
          name: step.name,
          status: "not_run",
          startedAt: nowIso(),
          finishedAt: nowIso(),
          detail: "Not run: the workflow halted at an earlier step.",
        });
        continue;
      }

      const stepStartedAt = nowIso();
      try {
        const result = await step.run(context);
        const finishedAt = nowIso();

        if (result.outcome === "halt") {
          halted = true;
          haltReason = result.reason;
          stepResults.push({ stepId: step.id, name: step.name, status: "halted", startedAt: stepStartedAt, finishedAt, detail: result.reason });
          await this.auditLogger.logEvent({
            actor: "workflow-engine",
            eventType: "workflow_step_halted",
            details: { runId, stepId: step.id, reason: result.reason },
          });
        } else if (result.outcome === "skipped") {
          stepResults.push({ stepId: step.id, name: step.name, status: "skipped", startedAt: stepStartedAt, finishedAt, detail: result.reason });
          await this.auditLogger.logEvent({
            actor: "workflow-engine",
            eventType: "workflow_step_skipped",
            details: { runId, stepId: step.id, reason: result.reason },
          });
        } else {
          stepResults.push({ stepId: step.id, name: step.name, status: "completed", startedAt: stepStartedAt, finishedAt, detail: null });
          await this.auditLogger.logEvent({
            actor: "workflow-engine",
            eventType: "workflow_step_completed",
            details: { runId, stepId: step.id },
          });
        }
      } catch (error) {
        const finishedAt = nowIso();
        const message = error instanceof Error ? error.message : String(error);
        stepResults.push({ stepId: step.id, name: step.name, status: "failed", startedAt: stepStartedAt, finishedAt, detail: message });
        await this.auditLogger.logEvent({
          actor: "workflow-engine",
          eventType: "workflow_step_failed",
          details: { runId, stepId: step.id, error: message },
        });
        halted = true;
        haltReason = `Step "${step.id}" (${step.name}) failed: ${message}`;
      }
    }

    const finishedAt = nowIso();
    await this.auditLogger.logEvent({
      actor: "workflow-engine",
      eventType: "workflow_completed",
      details: { runId, workflowName, halted, haltReason, completedSteps: stepResults.filter((s) => s.status === "completed").length },
    });

    return {
      runId,
      workflowName,
      startedAt,
      finishedAt,
      halted,
      haltReason,
      stepResults,
      outputs: Object.fromEntries(store),
    };
  }
}
