import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CliApprovalChannel } from "../../../src/core/governance/cli-approval-channel.js";
import type { ApprovalRequest } from "../../../src/core/types/approval.types.js";

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "req-1",
    reason: "ambiguous_match",
    summary: "Task X could not be routed automatically.",
    candidates: [
      { id: "agent-a", label: "Agent A", score: 0.6, rationale: "matched: seo" },
      { id: "agent-b", label: "Agent B", score: 0.55, rationale: "matched: content" },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Builds a fake stdin for a CliApprovalChannel test: each entry becomes one
 * line of reviewer input, fed in one at a time. Deliberately never ends the
 * stream (see the note on rl.close() below).
 *
 * Lines are written on separate event-loop turns rather than all at once.
 * node:readline only resolves the *currently pending* `rl.question()` when a
 * "line" event fires; if a line arrives while no question() is pending, it is
 * silently discarded (readline just re-emits it as a generic "line" event
 * that nothing here listens for). Writing every answer synchronously up
 * front lets multiple lines land in a single "data" event: readline resolves
 * the first pending question() from it, but resolving a promise doesn't
 * synchronously run its `.then()` continuation, so any further lines in that
 * same event are parsed and discarded before the code has awaited its way to
 * the next question() call -- leaving that next call waiting forever (the
 * timeout this fixture used to cause). A human at a real terminal can never
 * trigger this, since two keystrokes can't land in the same tick. Awaiting a
 * setImmediate between writes forces Node to fully drain the microtask queue
 * (including CliApprovalChannel's next `await rl.question()`) before the next
 * line is written, matching how input actually arrives in practice.
 */
function makeInput(lines: string[]): PassThrough {
  const input = new PassThrough();
  void feedLines(input, lines);
  return input;
}

async function feedLines(input: PassThrough, lines: string[]): Promise<void> {
  for (const line of lines) {
    input.write(`${line}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe("CliApprovalChannel", () => {
  it("selects the candidate at the entered index", async () => {
    const input = makeInput(["0", "looks right"]);
    const output = new PassThrough();
    const channel = new CliApprovalChannel(input, output);

    const decision = await channel.requestDecision(makeRequest());

    expect(decision.outcome).toBe("candidate_selected");
    expect(decision.selectedCandidateId).toBe("agent-a");
    expect(decision.notes).toBe("looks right");
  });

  it("re-prompts on an out-of-range index before accepting a valid one", async () => {
    const input = makeInput(["5", "1", ""]);
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const channel = new CliApprovalChannel(input, output);

    const decision = await channel.requestDecision(makeRequest());

    expect(decision.outcome).toBe("candidate_selected");
    expect(decision.selectedCandidateId).toBe("agent-b");
    expect(chunks.join("")).toContain("Please enter a number between 0 and 1");
  });

  it("returns a rejected outcome when the reviewer rejects", async () => {
    const input = makeInput(["reject", "not relevant"]);
    const output = new PassThrough();
    const channel = new CliApprovalChannel(input, output);

    const decision = await channel.requestDecision(makeRequest());

    expect(decision.outcome).toBe("rejected");
    expect(decision.notes).toBe("not relevant");
  });

  it('only accepts "reject" when there are no candidates', async () => {
    const input = makeInput(["0", "reject", ""]);
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const channel = new CliApprovalChannel(input, output);

    const decision = await channel.requestDecision(makeRequest({ candidates: [] }));

    expect(decision.outcome).toBe("rejected");
    expect(chunks.join("")).toContain("No candidates are available");
  });

  it("defaults the notes when the reviewer leaves them blank", async () => {
    const input = makeInput(["0", ""]);
    const output = new PassThrough();
    const channel = new CliApprovalChannel(input, output);

    const decision = await channel.requestDecision(makeRequest());

    expect(decision.notes).toContain("Agent A");
  });
});
