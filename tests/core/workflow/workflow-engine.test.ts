import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowEngine } from "../../../src/core/workflow/workflow-engine.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { WorkflowStep } from "../../../src/core/workflow/workflow-step.types.js";

function step(id: string, run: WorkflowStep["run"]): WorkflowStep {
  return { id, name: id, run };
}

describe("WorkflowEngine", () => {
  let dir: string;
  let engine: WorkflowEngine;
  let auditLogPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "workflow-engine-"));
    auditLogPath = join(dir, "audit-log.jsonl");
    engine = new WorkflowEngine(new AuditLogger(auditLogPath));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function readEventTypes(): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((l) => JSON.parse(l).eventType);
  }

  it("runs every step in order, sharing context via get/set", async () => {
    const seen: string[] = [];
    const steps: WorkflowStep[] = [
      step("a", async (ctx) => {
        ctx.set("value", 1);
        seen.push("a");
        return { outcome: "completed" };
      }),
      step("b", async (ctx) => {
        expect(ctx.get("value")).toBe(1);
        ctx.set("value", (ctx.get("value") as number) + 1);
        seen.push("b");
        return { outcome: "completed" };
      }),
    ];

    const result = await engine.run("test-workflow", steps);

    expect(seen).toEqual(["a", "b"]);
    expect(result.halted).toBe(false);
    expect(result.outputs.value).toBe(2);
    expect(result.stepResults.map((r) => r.status)).toEqual(["completed", "completed"]);
    expect(await readEventTypes()).toEqual([
      "workflow_started",
      "workflow_step_completed",
      "workflow_step_completed",
      "workflow_completed",
    ]);
  });

  it("continues past a skipped step", async () => {
    const steps: WorkflowStep[] = [
      step("a", async () => ({ outcome: "skipped", reason: "no data supplied" })),
      step("b", async () => ({ outcome: "completed" })),
    ];
    const result = await engine.run("test-workflow", steps);

    expect(result.halted).toBe(false);
    expect(result.stepResults[0]?.status).toBe("skipped");
    expect(result.stepResults[0]?.detail).toBe("no data supplied");
    expect(result.stepResults[1]?.status).toBe("completed");
  });

  it("halts the run when a step reports halt, and marks later steps not_run", async () => {
    const later = { ran: false };
    const steps: WorkflowStep[] = [
      step("a", async () => ({ outcome: "halt", reason: "human declined approval" })),
      step("b", async () => {
        later.ran = true;
        return { outcome: "completed" };
      }),
    ];
    const result = await engine.run("test-workflow", steps);

    expect(result.halted).toBe(true);
    expect(result.haltReason).toBe("human declined approval");
    expect(later.ran).toBe(false);
    expect(result.stepResults[0]?.status).toBe("halted");
    expect(result.stepResults[1]?.status).toBe("not_run");
  });

  it("halts the run and records the message when a step throws", async () => {
    const later = { ran: false };
    const steps: WorkflowStep[] = [
      step("a", async () => {
        throw new Error("boom");
      }),
      step("b", async () => {
        later.ran = true;
        return { outcome: "completed" };
      }),
    ];
    const result = await engine.run("test-workflow", steps);

    expect(result.halted).toBe(true);
    expect(result.haltReason).toContain("boom");
    expect(later.ran).toBe(false);
    expect(result.stepResults[0]?.status).toBe("failed");
    expect(result.stepResults[0]?.detail).toBe("boom");
    expect(await readEventTypes()).toContain("workflow_step_failed");
  });

  it("seeds the context from initialContext", async () => {
    const steps: WorkflowStep[] = [
      step("a", async (ctx) => {
        expect(ctx.get("seed")).toBe("hello");
        return { outcome: "completed" };
      }),
    ];
    await engine.run("test-workflow", steps, { seed: "hello" });
  });
});
