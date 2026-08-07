import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalChannel } from "../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../src/core/types/approval.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const APPROVE: ApprovalDecision = {
  requestId: "unused",
  outcome: "candidate_selected",
  selectedCandidateId: "publish",
  notes: "Looks good, approved.",
  decidedAt: new Date().toISOString(),
};

const REJECT: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "Not ready yet.",
  decidedAt: new Date().toISOString(),
};

describe("BlogGenerationWorkflow", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "blog-generation-workflow-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs Research -> Outline -> Article -> ... -> approval, and reports publishable:true when approved", async () => {
    const { BlogGenerationWorkflow } = await import("../../src/workflows/blog-generation-workflow.js");
    const workflow = await BlogGenerationWorkflow.create(dir, makeApprovalChannel(APPROVE));

    const result = await workflow.run({
      businessObjective: "Grow organic leads for a local plumbing business.",
      seedKeywords: ["emergency plumber", "drain cleaning"],
    });

    expect(result.halted).toBe(false);
    expect(result.stepResults.map((s) => s.status)).toEqual(Array(9).fill("completed"));
    expect(result.outputs["publishable"]).toBe(true);
    expect(result.outputs["draft"]).toBeDefined();
    expect(result.outputs["schema"]).toBeDefined();
    expect(result.outputs["metadata"]).toBeDefined();
    expect(result.outputs["publishingChecklist"]).toBeDefined();

    // No content generation provider configured -> real prose is honestly unavailable.
    const publishingChecklist = result.outputs["publishingChecklist"] as { realProseGenerated: boolean };
    expect(publishingChecklist.realProseGenerated).toBe(false);
  });

  it("NEVER auto-publishes: reports publishable:false and halts when a human declines", async () => {
    const { BlogGenerationWorkflow } = await import("../../src/workflows/blog-generation-workflow.js");
    const workflow = await BlogGenerationWorkflow.create(dir, makeApprovalChannel(REJECT));

    const result = await workflow.run({
      businessObjective: "Grow organic leads for a local plumbing business.",
      seedKeywords: ["emergency plumber"],
    });

    expect(result.halted).toBe(true);
    expect(result.outputs["publishable"]).toBe(false);
    expect(result.haltReason).toContain("Not ready yet.");
    const approvalStep = result.stepResults.find((s) => s.stepId === "publish-approval");
    expect(approvalStep?.status).toBe("halted");
  });

  it("halts at Research when no seed keywords are supplied, rather than fabricating a topic", async () => {
    const { BlogGenerationWorkflow } = await import("../../src/workflows/blog-generation-workflow.js");
    const workflow = await BlogGenerationWorkflow.create(dir, makeApprovalChannel(APPROVE));

    const result = await workflow.run({ businessObjective: "Grow organic leads.", seedKeywords: [] });

    expect(result.halted).toBe(true);
    expect(result.stepResults[0]?.status).toBe("halted");
    expect(result.outputs["publishable"]).toBeUndefined();
  });
});
